import { findPiiTokens, type Action, type PiiToken, type PlanRequest, type PlanResponse, type ScreenGraph, type StepRecord } from "@skrim/schema";
import { log } from "@skrim/shared";

import type { ErrorCode } from "../errors.ts";
import { newActionId, newTaskId } from "../id.ts";
import type { ActionPlanner } from "../integration.ts";
import { parseMessage, type ActionResultMessage, type Message } from "../messages.ts";
import type { NameFinder } from "../pii/gliner.js";
import { redactDomData } from "../pii/redact.js";
import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS, MAX_CONSECUTIVE_UNVERIFIED } from "../task-state.ts";
import { TokenVault } from "../vault/vault.js";
import type { PixelReader } from "../vision/read-pixels.ts";
import { unaskedCommitment } from "./commit-guard.ts";
import { DataGuard, type Concern } from "./data-guard.ts";
import { PrivateNames } from "./private-names.ts";
import { readPage, type PageReading } from "./read-page.ts";
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
  | { type: "observed"; step: number; elements: number; redactions: RedactionCounts; page: string; timings: PageReading["timings"] }
  | { type: "planned"; step: number; action: Action; targetLabel?: string; model: string; latencyMs: number }
  /**
   * `note` is what the planner is told in its history; `message` says the same
   * to the user, in plain words, when there is something to say. A step can be
   * reported twice: unverified, then verified once the next view shows it
   * changed the page after all.
   */
  | { type: "acted"; step: number; verified: boolean; note?: string; message?: string }
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

export interface TaskPermissions {
  allowedActions: Action["type"][];
  customInstructions?: string;
  /**
   * "provider:model": plans with this model instead of the server's. The user's
   * own key for it goes in a header (createServerPlanner), never in the request,
   * which the dashboard shows.
   */
  modelOverride?: string;
}

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
  /**
   * Reads text that exists only as pixels (a canvas, an image, a cross-origin
   * frame) with on-device OCR. Without it such text is invisible to the agent.
   */
  readPixels?: PixelReader;
  /**
   * Called once as the task ends, with the real values behind the
   * placeholders in its final answer, and nothing else from the vault: asked
   * "what is my PAN?", the planner can only answer "<PII:GOV_ID:1>", and the
   * side panel shows the real number when the user asks to see it. The values
   * never go into an AgentEvent, which the dashboard feed also reads, and
   * never to the server. Not called when the answer holds no placeholder.
   */
  onAnswerValues?: (values: ReadonlyMap<PiiToken, string>) => void;
  /**
   * Asks the user whether a step may type a personal value the data guard
   * (lib/agent/data-guard.ts) cannot allow by itself; resolves true to allow.
   * `values` are the real values behind the placeholders asked about, for the
   * panel to show on request, like `onAnswerValues`: never in an AgentEvent.
   * Without it, such a step is refused.
   */
  confirmDataUse?: (question: DataUseQuestion, values: ReadonlyMap<PiiToken, string>, signal: AbortSignal) => Promise<boolean>;
  maxSteps?: number;
  timeoutMs?: number;
  permissions?: TaskPermissions;
}

/** A step that would type personal values the data guard cannot allow by itself. Redacted: tokens only. */
export interface DataUseQuestion {
  step: number;
  /** The placeholders it would type that need the user's say-so, and why each does. */
  asks: Array<{ token: PiiToken; concern: Concern }>;
  /** The field, as the server saw it. */
  field?: string;
  /** The site it is on, as an origin. */
  site: string;
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
    // Before the vault is cleared (the finally below).
    if (result.summary && options.onAnswerValues) {
      const values = new Map<PiiToken, string>();
      for (const token of findPiiTokens(result.summary)) {
        const value = vault.resolve(token);
        if (value !== undefined) values.set(token, value);
      }
      if (values.size > 0) options.onAnswerValues(values);
    }
    onEvent({ type: "finished", steps: step, tokens: vault.stats(), ...result });
  };

  // Name detection is async; redaction is not. So before each redaction the
  // model reads what it needs to, and redaction looks the results up.
  // It fails closed: without the model, names and addresses would go out as
  // they are, so the task stops before the next request is sent.
  let namesFailed = false;
  const names = new PrivateNames(options.findNames, (error) => {
    namesFailed = true;
    log.warn("agent.nameFinderFailed", { taskId, error: error instanceof Error ? error.name : "unknown" });
  });
  const stopForNames = (): void => finish({
    outcome: "failed",
    errorCode: "NAME_DETECTION_FAILED",
    message: "Name and address detection could not start, so Skrim stopped before sending anything. Close and reopen this panel, then try again.",
  });

  log.info("agent.started", { taskId });
  try {
    // Before the first page view: every name in the goal is hidden, on the
    // pages too (lib/agent/private-names.ts).
    const goalNames = await names.prepareGoal(options.goal);
    if (namesFailed) return stopForNames();
    const goal = redactText(options.goal, vault, goalNames);
    // Custom instructions are the user's own words, sent with every step:
    // redacted like the goal, every name in them hidden.
    const rules = options.permissions?.customInstructions?.trim();
    const customInstructions = rules ? redactText(rules, vault, await names.prepareGoal(rules)) : undefined;
    if (namesFailed) return stopForNames();
    // Where each value came from, for the data guard (lib/agent/data-guard.ts).
    const guard = new DataGuard(rules ? `${options.goal} ${rules}` : options.goal);
    guard.sawGoal(findPiiTokens(`${goal} ${customInstructions ?? ""}`));
    onEvent({ type: "started", taskId, redactedGoal: goal });
    let unverifiedInARow = 0;
    const stateVisits = new Map<string, number>();
    let lastState: string | undefined;
    let previousGraph: ScreenGraph | undefined;
    /** The last step carried out, and the page it was carried out on. */
    let lastTaken: { state: string; key: string } | undefined;

    for (step = 0; step < maxSteps; step++) {
      const reading = await readPage(link, taskId, signal, names, vault, step, options.readPixels);
      if (!reading) {
        const reason = (await link.whyUnreachable?.()) ?? "Skrim cannot read this tab. Reload the page and try again.";
        return finish({ outcome: "failed", errorCode: "CONTENT_SCRIPT_ERROR", message: reason });
      }
      if (!reading.observation.graphAvailable) {
        return finish({ outcome: "failed", errorCode: "OBSERVATION_FAILED", message: "The page did not produce a screen graph." });
      }
      if (namesFailed) return stopForNames();
      const { page } = reading;
      const site = page.graph.url.origin;
      guard.sawPage(site, findPiiTokens(page.graph.manifest.tokensInPlay.join(" ")));
      onEvent({ type: "observed", step, elements: page.graph.elements.length, redactions: page.redactions, page: `${page.graph.url.origin}${page.graph.url.pathTemplate}`, timings: reading.timings });

      // What the last action changed on screen goes into its history entry.
      const lastStep = history.at(-1);
      if (lastStep && previousGraph) {
        const change = describeChange(previousGraph, page.graph);
        if (change && !lastStep.verified && lastStep.note?.startsWith(NO_CHANGE)) {
          // The action watcher missed it, but this view shows the step did
          // change the page: a search icon that reveals the search box by
          // restyling a plain container. Say so, here and in the chat.
          lastStep.verified = true;
          lastStep.note = joinNotes(lastStep.note.slice(NO_CHANGE.length).replace(/^; /, "") || undefined, change);
          unverifiedInARow = Math.max(0, unverifiedInARow - 1);
          onEvent({ type: "acted", step: lastStep.cycle, verified: true });
        } else if (change) {
          lastStep.note = joinNotes(lastStep.note, change);
        }
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
        ...(customInstructions ? { customInstructions } : {}),
        ...(options.permissions?.modelOverride ? { modelOverride: options.permissions.modelOverride } : {}),
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

      // A click that would place an order, pay, delete or create an account is
      // refused unless the goal asks for it (lib/agent/commit-guard.ts).
      const refused = action.type === "click" && target ? unaskedCommitment(`${target.label ?? ""} ${target.value ?? ""}`, options.goal) : undefined;
      // The same step again, on a page unchanged since it was last taken, can
      // only do the same again: Qwen3-VL 4B clicked one link 20 times, each
      // click "verified" because the page redrew. Not a wait: a page still
      // loading looks the same between waits.
      const key = actionKey(action);
      const repeated = action.type !== "wait" && lastTaken?.state === state && lastTaken.key === key;
      const notAllowed = options.permissions && !options.permissions.allowedActions.includes(action.type);
      
      let outcome: ActOutcome;
      if (notAllowed) {
        outcome = { verified: false, note: `not allowed: the action type '${action.type}' is not permitted for this task. Try a different action or answer done`, message: `Skipped: not allowed to ${action.type}.` };
        log.info("agent.refusedPermission", { taskId, step, action: action.type });
      } else if (refused) {
        outcome = { verified: false, note: `not clicked: it would ${refused}, which the goal does not ask for. If the goal is met, answer done`, message: `Skipped: it would ${refused}, which you didn't ask for.` };
        log.info("agent.refusedCommitment", { taskId, step });
      } else if (repeated) {
        outcome = { verified: false, note: "not done again: this exact step was just taken on this same page, and the page is as it was then. If the goal is met, answer done; if not, try something else", message: "Skipped: the same step again would change nothing." };
        log.info("agent.refusedRepeat", { taskId, step });
      } else {
        // Typing a personal value the goal did not ask for, on another site,
        // or an ID, card or account number: the user says whether it may.
        const withheld = action.type === "type"
          ? await checkDataUse({ step, value: action.value, field: target?.label, site, guard, vault, confirm: options.confirmDataUse, signal })
          : undefined;
        if (withheld) {
          outcome = withheld;
          log.info("agent.withheldData", { taskId, step });
        } else {
          // Text read from pixels has no element behind it in the page.
          outcome = target?.source === "vision"
            ? actOnPixelText(action, reading.observation.elements?.find((element) => element.id === target.id)?.label)
            : await act(link, taskId, step, action, { vault, names }, signal);
          lastTaken = { state, key };
        }
      }
      history.push({ cycle: step, action, verified: outcome.verified, ...(outcome.note ? { note: outcome.note } : {}) });
      onEvent({ type: "acted", step, verified: outcome.verified, ...(outcome.note ? { note: outcome.note } : {}), ...(outcome.message ? { message: outcome.message } : {}) });
      if (action.type === "extract" && outcome.extractedValue) {
        await names.prepareTexts([outcome.extractedValue]);
        extracted[action.as] = redactText(outcome.extractedValue, vault, names.lookup);
        guard.sawPage(site, findPiiTokens(extracted[action.as]!));
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

/** An action without its reason, the same however the model ordered its fields. */
function actionKey(action: Action): string {
  const { reason: _reason, ...rest } = action;
  return JSON.stringify(rest, Object.keys(rest).sort());
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
  /** For the planner's history. */
  note?: string;
  /** For the user, in the chat. */
  message?: string;
  extractedValue?: string;
}

/** Short, PII-free notes the planner reads in its history, and what the user is told. */
const ERROR_NOTES: Partial<Record<ErrorCode, { note: string; message: string }>> = {
  TARGET_NOT_FOUND: { note: "no such element on the page any more; ids change after every action", message: "That was no longer on the page." },
  TARGET_NOT_CLICKABLE: { note: "the element is disabled or hidden", message: "That is disabled or hidden." },
  NAVIGATION_BLOCKED: { note: "navigation to another site is not allowed", message: "Skipped: it leads to another site." },
  MALFORMED_ACTION: { note: "the action was malformed", message: "The planner's step could not be carried out." },
  CONTENT_SCRIPT_ERROR: { note: "the action failed inside the page", message: "The page did not accept that step." },
};

/**
 * An action on a line read from pixels (lib/vision/read-pixels.ts). The page
 * has no element behind it, so the content script cannot resolve its id; the
 * side panel holds the text it read, so it answers an extract itself.
 * `rawText` is the line as read, before redaction: the loop redacts the
 * extracted value like any other.
 */
function actOnPixelText(action: Action, rawText: string | undefined): ActOutcome {
  if (action.type === "extract" && rawText) return { verified: true, extractedValue: rawText };
  return {
    verified: false,
    note: "that is text read from an image of the screen: it can be read (quote it, or extract it), not clicked or typed into",
    message: "That text is part of an image on the page, so Skrim can read it but not click it.",
  };
}

interface DataUseCheck {
  step: number;
  /** The planned value, placeholders and all. */
  value: string;
  field?: string;
  site: string;
  guard: DataGuard;
  vault: TokenVault;
  confirm?: AgentOptions["confirmDataUse"];
  signal: AbortSignal;
}

/**
 * Whether a planned "type" may put these personal values on this page
 * (lib/agent/data-guard.ts). Undefined when it may; otherwise the refused
 * step's outcome. Asks the user when the guard cannot decide alone.
 */
async function checkDataUse({ step, value, field, site, guard, vault, confirm, signal }: DataUseCheck): Promise<ActOutcome | undefined> {
  const tokens = findPiiTokens(value);
  // A placeholder this task never issued is act()'s to refuse, not a question.
  if (tokens.length === 0 || tokens.some((token) => vault.resolve(token) === undefined)) return undefined;
  const { ask, refused } = guard.check(tokens, site);
  if (refused.length > 0) return withheld(refused, true);
  if (ask.length === 0) return undefined;
  let allowed = false;
  if (confirm) {
    const values = new Map(ask.map(({ token }) => [token, vault.resolve(token)!] as const));
    allowed = await untilAborted(confirm({ step, asks: ask, ...(field ? { field } : {}), site }, values, signal), signal);
  }
  const asked = ask.map(({ token }) => token);
  guard.decide(asked, site, allowed);
  return allowed ? undefined : withheld(asked, confirm !== undefined);
}

/** A step not taken because the user did not allow, or could not be asked to allow, these values here. */
function withheld(tokens: PiiToken[], couldAsk: boolean): ActOutcome {
  const listed = tokens.join(", ");
  return {
    verified: false,
    note: clip(`not typed: the user did not allow ${listed} to be used here. Do not type it again; leave that field out, or answer done if nothing else is needed`, 200),
    message: couldAsk ? `Not typed: you didn't allow ${tokens.join(" or ")} here.` : `Not typed: using ${tokens.join(" and ")} here needs your permission.`,
  };
}

/** `promise`, or the abort: a question left unanswered must not outlive a stopped task. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (result) => { signal.removeEventListener("abort", onAbort); resolve(result); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

/** The planner's note for an action the page did not react to. */
const NO_CHANGE = "the page did not change";

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
    if (!resolved.ok) return { verified: false, note: `not typed: ${resolved.unknown.join(", ")} is not a token on this page`, message: "Skipped: the planner used a placeholder that stands for nothing on this page." };
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
    if (result?.type !== "action.result") return { verified: false, note: "the page did not answer", message: "The page did not respond." };
    if (!result.ok) {
      return { verified: false, ...(ERROR_NOTES[result.errorCode ?? "CONTENT_SCRIPT_ERROR"] ?? { note: "the action failed", message: "That step failed." }) };
    }
    if (result.changed || action.type !== "scroll") {
      if (result.targetAfter) await privacy.names.prepareTexts([result.targetAfter.label, result.targetAfter.value]);
      const after = result.targetAfter ? describeTarget(result.targetAfter, privacy) : undefined;
      const note = result.changed ? after : [NO_CHANGE, after].filter(Boolean).join("; ");
      return {
        verified: result.changed,
        ...(note ? { note } : {}),
        ...(result.changed ? {} : { message: "Nothing changed on the page." }),
        ...(result.extractedValue === undefined ? {} : { extractedValue: result.extractedValue }),
      };
    }
    // A scroll that moved nothing has reached the end. Saying so stops a
    // planner scrolling on, looking for something that is not there.
    const end = action.direction === "up" ? "top" : action.direction === "down" ? "bottom" : "edge";
    const what = action.target ? "that area" : "the page";
    return {
      verified: false,
      note: `${what} did not move: it is already at the ${end}, so what the goal needs is not further ${action.direction}`,
      message: `Already at the ${end} of ${what}.`,
    };
  } finally {
    watch.stop();
  }
}
