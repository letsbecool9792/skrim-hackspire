import type { Action, PlanRequest, PlanResponse, ScreenGraph, StepRecord } from "@skrim/schema";
import { log } from "@skrim/shared";

import type { ErrorCode } from "../errors.ts";
import { newActionId, newTaskId } from "../id.ts";
import type { ActionPlanner } from "../integration.ts";
import { parseMessage, type ActionResultMessage, type Message } from "../messages.ts";
import type { NameFinder } from "../pii/gliner.js";
import { redactDomData } from "../pii/redact.js";
import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS, MAX_CONSECUTIVE_UNVERIFIED } from "../task-state.ts";
import { TokenVault } from "../vault/vault.js";
import { PrivateNames } from "./private-names.ts";
import { readPage } from "./read-page.ts";
import { redactText, resolveTokens, type RedactionCounts } from "./redact.ts";

/**
 * THE AGENT LOOP: observe -> redact -> plan -> act -> verify, one action per
 * cycle, until the planner says done or a limit is hit.
 *
 * It runs in the side panel, not the background. Chrome terminates an
 * extension service worker when a fetch() takes more than 30 s, and a local
 * model can take longer than that for one step. The side panel is an ordinary
 * extension page with no such limit, and the task, its vault and the chat all
 * live exactly as long as the panel the user is looking at.
 */

/** How the loop reaches the page. The side panel wires it to one tab; tests wire it to a DOM in memory. */
export interface PageLink {
  /** Sends to the content script; resolves to its reply, or undefined when nothing answered. */
  send(message: Message): Promise<unknown>;
  /** Starts watching the tab for a page load. */
  watchNavigation(): NavigationWatch;
  /** Why the page cannot be reached, in words the user can act on. */
  whyUnreachable?(): Promise<string>;
}

export interface NavigationWatch {
  /** Whether the tab started loading a new page since the watch began. */
  readonly started: boolean;
  /** Resolves true once a load starts, or false after `ms`. */
  whenStarted(ms: number): Promise<boolean>;
  /** Resolves true once that load finishes, or false after `ms`. */
  loaded(ms: number): Promise<boolean>;
  stop(): void;
}

/**
 * What the UI shows. Everything in here is already redacted: the chat shows
 * what the server saw, which doubles as proof of what it did not see.
 */
export type AgentEvent =
  | { type: "started"; taskId: string; redactedGoal: string }
  | { type: "observed"; step: number; elements: number; redactions: RedactionCounts; page: string }
  | { type: "planned"; step: number; action: Action; targetLabel?: string; model: string; latencyMs: number }
  | { type: "acted"; step: number; verified: boolean; note?: string }
  /** Something the user should know that does not stop the task. */
  | { type: "warning"; message: string }
  | {
      type: "finished";
      outcome: "completed" | "failed" | "cancelled";
      steps: number;
      /** Distinct personal values this task replaced with tokens, by category. */
      tokens: RedactionCounts;
      summary?: string;
      errorCode?: ErrorCode;
      message?: string;
    };

export interface AgentOptions {
  goal: string;
  planner: ActionPlanner;
  link: PageLink;
  /** Aborted when the user presses stop or closes the panel. */
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  /**
   * Finds names and addresses (the GLiNER model). Without it only the regex
   * detectors and form-field hints run, which miss names in free text.
   */
  findNames?: NameFinder;
  maxSteps?: number;
  timeoutMs?: number;
}

/** The schema caps history at 20 steps; older steps matter least. */
const MAX_HISTORY = 20;
/**
 * A page state seen this many times means the agent is going in circles:
 * toggling a panel open and shut, say, which Qwen3-VL 4B did 25 times for
 * "Click show panel". Stopping does not depend on the model noticing.
 */
const MAX_SAME_STATE_VISITS = 3;
/** How long a new page may take to finish loading after a click or navigate. */
const PAGE_LOAD_TIMEOUT_MS = 15_000;
/**
 * How long to wait for a page load to start when an action got no reply. A
 * link click unloads the page before the content script can answer, and the
 * tab's "loading" event can arrive after that failed reply.
 */
const LOAD_START_GRACE_MS = 2_000;

type Finish = Omit<Extract<AgentEvent, { type: "finished" }>, "type" | "steps" | "tokens">;

export async function runAgentTask(options: AgentOptions): Promise<void> {
  const { planner, link, onEvent } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Not AbortSignal.timeout(): its timer outlives a task that ended early.
  const timeoutController = new AbortController();
  const timeout = timeoutController.signal;
  const timer = setTimeout(() => timeoutController.abort(new DOMException("Task time budget used up", "TimeoutError")), timeoutMs);
  const signal = AbortSignal.any([options.signal, timeout]);
  const taskId = newTaskId();
  const vault = new TokenVault();
  const history: StepRecord[] = [];
  const extracted: Record<string, string> = {};
  let step = 0;

  const finish = (result: Finish): void => {
    log.info("agent.finished", { taskId, outcome: result.outcome, steps: step, errorCode: result.errorCode });
    onEvent({ type: "finished", steps: step, tokens: vault.stats(), ...result });
  };

  // Name detection is async; redaction is not. So before each redaction the
  // model reads what it needs to, and redaction looks the results up.
  const names = new PrivateNames(options.findNames, (error) => {
    // Fails open, loudly: the task continues with the regex detectors only.
    // Revisit now that name detection works in Chrome (CLAUDE.md).
    log.warn("agent.nameFinderFailed", { taskId, error: error instanceof Error ? error.name : "unknown" });
    onEvent({ type: "warning", message: "Name and address detection could not start, so names and addresses are NOT being hidden in this task. Emails, phone numbers, cards and ID numbers still are." });
  });
  // Redacted after the first page view: whether a name in it is private
  // depends on that page (lib/agent/private-names.ts).
  let goal: string | undefined;

  log.info("agent.started", { taskId });
  try {
    let unverifiedInARow = 0;
    const stateVisits = new Map<string, number>();
    let lastState: string | undefined;
    let previousGraph: ScreenGraph | undefined;

    for (step = 0; step < maxSteps; step++) {
      const reading = await readPage(link, taskId, signal, names, vault, step);
      if (!reading) {
        const reason = (await link.whyUnreachable?.()) ?? "Skrim cannot read this tab. Reload the page and try again.";
        return finish({ outcome: "failed", errorCode: "CONTENT_SCRIPT_ERROR", message: reason });
      }
      if (!reading.observation.graphAvailable) {
        return finish({ outcome: "failed", errorCode: "OBSERVATION_FAILED", message: "The page did not produce a screen graph." });
      }
      const { page } = reading;
      if (goal === undefined) {
        goal = redactText(options.goal, vault, await names.prepareGoal(options.goal, reading.personal));
        onEvent({ type: "started", taskId, redactedGoal: goal });
      }
      onEvent({ type: "observed", step, elements: page.graph.elements.length, redactions: page.redactions, page: `${page.graph.url.origin}${page.graph.url.pathTemplate}` });

      // What the last action changed on screen goes into its history entry.
      const lastStep = history.at(-1);
      if (lastStep && previousGraph) {
        const change = describeChange(previousGraph, page.graph);
        if (change) lastStep.note = joinNotes(lastStep.note, change);
      }
      previousGraph = page.graph;

      // Count arrivals, not stays: a page that did not change at all is the
      // unverified-step rule's business, not this one's.
      const state = pageState(page.graph);
      if (state !== lastState) {
        const visits = (stateVisits.get(state) ?? 0) + 1;
        stateVisits.set(state, visits);
        lastState = state;
        if (visits >= MAX_SAME_STATE_VISITS) {
          return finish({ outcome: "failed", errorCode: "NO_PROGRESS", message: "The page keeps coming back to the same state, so the agent is going in circles." });
        }
      }

      const request: PlanRequest = {
        goal,
        graph: page.graph,
        history: history.slice(-MAX_HISTORY),
        ...(Object.keys(extracted).length > 0 ? { extracted: { ...extracted } } : {}),
      };
      let plan: PlanResponse;
      try {
        plan = await planner(request, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("Outbound payload contains unredacted PII")) {
          return finish({ outcome: "failed", errorCode: "PII_TRIPWIRE", message: "Stopped before sending: the request still contained personal data the detectors missed. Nothing was sent." });
        }
        return finish({ outcome: "failed", errorCode: "PLANNER_ERROR", message });
      }

      const { action } = plan;
      const target = "target" in action && action.target ? page.graph.elements.find((element) => element.id === action.target) : undefined;
      onEvent({ type: "planned", step, action, targetLabel: target?.label ?? target?.value, model: plan.model, latencyMs: plan.latencyMs });
      log.info("agent.planned", { taskId, step, elements: page.graph.elements.length, action: action.type, latencyMs: plan.latencyMs, repairs: plan.repairs });

      if (action.type === "done") {
        return finish(action.success
          ? { outcome: "completed", summary: action.summary }
          : { outcome: "failed", errorCode: "GOAL_NOT_ACHIEVED", summary: action.summary });
      }

      const outcome = await act(link, taskId, step, action, { vault, names }, signal);
      history.push({ cycle: step, action, verified: outcome.verified, ...(outcome.note ? { note: outcome.note } : {}) });
      onEvent({ type: "acted", step, verified: outcome.verified, note: outcome.note });
      if (action.type === "extract" && outcome.extractedValue) {
        await names.prepareTexts([outcome.extractedValue]);
        extracted[action.as] = redactText(outcome.extractedValue, vault, names.lookup);
      }

      unverifiedInARow = outcome.verified ? 0 : unverifiedInARow + 1;
      if (unverifiedInARow >= MAX_CONSECUTIVE_UNVERIFIED) {
        step += 1;
        return finish({ outcome: "failed", errorCode: "NO_PROGRESS", message: `The last ${MAX_CONSECUTIVE_UNVERIFIED} steps changed nothing on the page.` });
      }
    }
    return finish({ outcome: "failed", errorCode: "MAX_STEPS_REACHED", message: `Stopped after ${maxSteps} steps.` });
  } catch (error) {
    if (timeout.aborted) return finish({ outcome: "failed", errorCode: "TASK_TIMEOUT", message: `Stopped after ${Math.round(timeoutMs / 1000)} s.` });
    if (options.signal.aborted) return finish({ outcome: "cancelled" });
    log.error("agent.crashed", { taskId, step, error: error instanceof Error ? error.name : "unknown" });
    return finish({ outcome: "failed", errorCode: "CONTENT_SCRIPT_ERROR", message: "Something went wrong inside Skrim. The extension's console has the details." });
  } finally {
    clearTimeout(timer);
    // The vault is the only place real values live. It dies with the task.
    vault.clear();
  }
}

/**
 * What the page says, without where things sit: positions shift with every
 * scroll and would make every state look new. Redacted input, so no PII.
 */
function pageState(graph: ScreenGraph): string {
  const elements = graph.elements.map((e) => [e.role, e.label ?? "", e.value ?? "", (e.state ?? []).filter((s) => s !== "focused" && s !== "offscreen").join(",")].join("\u0001"));
  return `${graph.url.origin}${graph.url.pathTemplate}\u0002${graph.title}\u0002${elements.join("\u0002")}`;
}

/** At most this many elements are named in "appeared: ..." and "went away: ...". */
const MAX_CHANGES_LISTED = 3;

/**
 * What changed on screen between two views, for the history: "appeared:
 * text "This is the toggled panel content."". Small models tell that a goal is
 * done from this far more reliably than from "verified": with "verified"
 * alone, Qwen3-VL 4B clicked a panel's toggle again, closing it, and kept
 * clicking a same-page link after it had scrolled there.
 * Redacted input, so no PII.
 */
function describeChange(before: ScreenGraph, after: ScreenGraph): string | undefined {
  if (`${before.url.origin}${before.url.pathTemplate}` !== `${after.url.origin}${after.url.pathTemplate}`) {
    return `a new page opened: ${JSON.stringify(clip(after.title, 60))}`;
  }
  const was = namedElements(before);
  const now = namedElements(after);
  // New to the page, or scrolled into view ("Go to section 2"). Leaving the
  // view is not listed: after any scroll that would be most of the page.
  const appeared = [...now]
    .filter(([key, element]) => !was.has(key) || (element.onScreen && !was.get(key)!.onScreen))
    .map(([, element]) => element.text);
  const wentAway = [...was].filter(([key]) => !now.has(key)).map(([, element]) => element.text);
  const parts: string[] = [];
  if (appeared.length > 0) parts.push(`appeared: ${listSome(appeared)}`);
  if (wentAway.length > 0) parts.push(`went away: ${listSome(wentAway)}`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

/**
 * Elements by role and name, and whether any with that name is in view. Keyed
 * by name only, so a button whose text changed is not "new": its own note
 * says what it shows now. Off-screen elements count: a form's "Thanks, sent"
 * line often lands below the fold.
 */
function namedElements(graph: ScreenGraph): Map<string, { text: string; onScreen: boolean }> {
  const named = new Map<string, { text: string; onScreen: boolean }>();
  for (const element of graph.elements) {
    const name = element.label ?? element.value;
    if (!name) continue;
    const key = `${element.role}\u0001${name}`;
    const onScreen = !element.state?.includes("offscreen") || named.get(key)?.onScreen === true;
    named.set(key, { text: `${element.role} ${JSON.stringify(clip(name, 40))}`, onScreen });
  }
  return named;
}

function listSome(items: string[]): string {
  const listed = items.slice(0, MAX_CHANGES_LISTED).join(", ");
  return items.length > MAX_CHANGES_LISTED ? `${listed} and ${items.length - MAX_CHANGES_LISTED} more` : listed;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** The schema caps a history note at 200 characters. */
function joinNotes(first: string | undefined, second: string): string {
  return clip(first ? `${first}; ${second}` : second, 200);
}


interface ActOutcome {
  verified: boolean;
  note?: string;
  extractedValue?: string;
}

/** Short, PII-free notes the planner reads in its history. */
const ERROR_NOTES: Partial<Record<ErrorCode, string>> = {
  TARGET_NOT_FOUND: "no such element on the page any more; ids change after every action",
  TARGET_NOT_CLICKABLE: "the element is disabled or hidden",
  NAVIGATION_BLOCKED: "navigation to another site is not allowed",
  MALFORMED_ACTION: "the action was malformed",
  CONTENT_SCRIPT_ERROR: "the action failed inside the page",
};

/** States worth reporting after an action. "focused" is not: every click causes it. */
const REPORTED_STATES = new Set(["checked", "unchecked", "expanded", "collapsed", "selected", "disabled", "invalid"]);

/**
 * What the action's target shows now, for the history: "now it shows
 * "Count: 1"", "now it is expanded". Small models notice they are done from
 * this far more reliably than from "verified" alone. Redacted like the rest.
 */
function describeTarget(target: NonNullable<ActionResultMessage["targetAfter"]>, privacy: Privacy): string | undefined {
  const { value } = redactDomData({ label: target.label, value: target.value }, privacy.vault, privacy.names.lookup);
  const parts: string[] = [];
  if (value) parts.push(`shows ${JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value)}`);
  const states = (target.state ?? []).filter((state) => REPORTED_STATES.has(state));
  if (states.length > 0) parts.push(`is ${states.join(", ")}`);
  return parts.length > 0 ? `now it ${parts.join(" and ")}`.slice(0, 150) : undefined;
}

/** The task's vault, and which names in it are private. */
interface Privacy {
  vault: TokenVault;
  names: PrivateNames;
}

async function act(link: PageLink, taskId: string, step: number, action: Action, privacy: Privacy, signal: AbortSignal): Promise<ActOutcome> {
  let typedValue: string | undefined;
  if (action.type === "type") {
    const resolved = resolveTokens(action.value, privacy.vault);
    // The model used a token this task never issued. Typing it literally is
    // the one thing we never do, so the step is skipped and reported.
    if (!resolved.ok) return { verified: false, note: `not typed: ${resolved.unknown.join(", ")} is not a token on this page` };
    typedValue = resolved.value;
  }

  const watch = link.watchNavigation();
  try {
    const reply = await link.send({ type: "action.execute", action, actionId: newActionId(step), taskId, ...(typedValue === undefined ? {} : { typedValue }) });
    signal.throwIfAborted();
    const result = parseMessage(reply);

    // A click on a link, or a navigate, unloads the page, often before the
    // content script can reply. A page load is the change we were after.
    if (action.type === "navigate" || result?.type !== "action.result") await watch.whenStarted(action.type === "navigate" ? 500 : LOAD_START_GRACE_MS);
    signal.throwIfAborted();
    if (watch.started) {
      const loaded = await watch.loaded(PAGE_LOAD_TIMEOUT_MS);
      signal.throwIfAborted();
      return loaded ? { verified: true } : { verified: true, note: "a new page was still loading" };
    }

    // No reply and no page load. If the page is really gone, the next
    // observation says so, in words the user can act on.
    if (result?.type !== "action.result") return { verified: false, note: "the page did not answer" };
    if (!result.ok) {
      return { verified: false, note: ERROR_NOTES[result.errorCode ?? "CONTENT_SCRIPT_ERROR"] ?? "the action failed" };
    }
    if (result.targetAfter) await privacy.names.prepareTexts([result.targetAfter.label, result.targetAfter.value]);
    const after = result.targetAfter ? describeTarget(result.targetAfter, privacy) : undefined;
    const note = result.changed ? after : ["the page did not change", after].filter(Boolean).join("; ");
    return { verified: result.changed, ...(note ? { note } : {}), ...(result.extractedValue === undefined ? {} : { extractedValue: result.extractedValue }) };
  } finally {
    watch.stop();
  }
}
