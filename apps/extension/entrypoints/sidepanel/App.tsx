import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Action, PiiCategory, PiiToken } from "@skrim/schema";
import { AlertTriangle, ArrowDownUp, ArrowRight, ArrowUp, ChevronsUpDown, CircleCheck, Clock, Eraser, Eye, EyeOff, Keyboard, MousePointer2, ScanText, ShieldAlert, ShieldCheck, Square, type LucideIcon } from "lucide-react";
import type { ErrorCode } from "@/lib/errors.ts";
import { getActionPlanner } from "@/lib/integration.ts";
import { runAgentTask, type AgentEvent, type DataUseQuestion } from "@/lib/agent/loop.ts";
import { categoryOf, type Concern } from "@/lib/agent/data-guard.ts";
import type { RedactionCounts } from "@/lib/agent/redact.ts";
import type { NameFinder } from "@/lib/pii/gliner.ts";
import { fetchServerInfo, type ServerInfo } from "@/lib/agent/server-planner.ts";
import { tabLink } from "@/lib/agent/tab-link.ts";
import { panelTargetFromUrl } from "@/lib/agent/panel-target.ts";
import { tabPixelReader } from "@/lib/vision/read-pixels.ts";
import { SERVER_URL } from "./config.ts";
import { feed } from "./feed-instance.ts";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

/** Set when the panel is a tab of its own (Firefox for Android): the tab it works on. */
const PANEL_TARGET = panelTargetFromUrl(location.href);

/**
 * Firefox lets a user withhold an MV3 add-on's site access, and then the
 * content script never runs and every task fails to reach the page. Chrome
 * grants it at install.
 */
async function hasSiteAccess(): Promise<boolean> {
  if (!import.meta.env.FIREFOX) return true;
  return browser.permissions.contains({ origins: ["<all_urls>"] }).catch(() => true);
}

// ─── Chat model ────────────────────────────────────────────────────────────

type Finished = Extract<AgentEvent, { type: "finished" }>;

interface StepView {
  step: number;
  action: Action;
  targetLabel?: string;
  latencyMs: number;
  verified?: boolean;
  /** What happened, for the user; the planner's own note is not shown. */
  message?: string;
  /** The site the step was taken on, for the Privacy record of what was typed where. */
  site?: string;
}

/** A question from the data guard, open until the user answers it or the task ends. */
interface OpenQuestion {
  question: DataUseQuestion;
  /** The real values behind its placeholders: shown here only, on a click. */
  values: ReadonlyMap<string, string>;
  answer: (allowed: boolean) => void;
}

interface TaskItem {
  kind: "task";
  id: number;
  goal: string;
  redactedGoal?: string;
  phase: "starting" | "reading" | "planning" | "acting" | "done";
  steps: StepView[];
  redactions?: RedactionCounts;
  warnings: string[];
  finished?: Finished;
  /**
   * The real values behind the placeholders in the final answer, from the
   * task's vault as it ended (AgentOptions.onAnswerValues). Memory only: gone
   * when the chat is cleared or the panel closes. Shown one pill at a time,
   * when the user clicks it.
   */
  answerValues?: ReadonlyMap<string, string>;
  /** The page of the last view, for the steps planned on it. */
  page?: string;
  question?: OpenQuestion;
}

/** "https://docs.google.com/forms/..." -> "docs.google.com". */
function hostOf(page: string | undefined): string | undefined {
  if (!page) return undefined;
  try {
    return new URL(page).host || undefined;
  } catch {
    return undefined;
  }
}

function applyEvent(task: TaskItem, event: AgentEvent): TaskItem {
  switch (event.type) {
    case "started":
      return { ...task, redactedGoal: event.redactedGoal, phase: "reading" };
    case "observed":
      return { ...task, phase: "planning", redactions: event.redactions, page: event.page };
    case "planned":
      if (event.action.type === "done") return task;
      return { ...task, phase: "acting", steps: [...task.steps, { step: event.step, action: event.action, targetLabel: event.targetLabel, latencyMs: event.latencyMs, site: hostOf(task.page) }] };
    case "acted":
      return { ...task, phase: "reading", steps: task.steps.map((s) => (s.step === event.step ? { ...s, verified: event.verified, message: event.message } : s)) };
    case "warning":
      return { ...task, warnings: [...task.warnings, event.message] };
    case "finished":
      return { ...task, phase: "done", finished: event };
  }
}

// ─── Wording ───────────────────────────────────────────────────────────────

const CATEGORY_WORDS: Record<PiiCategory, [string, string]> = {
  EMAIL: ["email address", "email addresses"],
  PHONE: ["phone number", "phone numbers"],
  NAME: ["name", "names"],
  ADDRESS: ["address", "addresses"],
  CARD: ["card number", "card numbers"],
  GOV_ID: ["ID number", "ID numbers"],
  ACCOUNT: ["account number", "account numbers"],
  DOB: ["birth date", "birth dates"],
  FACE: ["face", "faces"],
  OTHER: ["private value", "private values"],
};

const TOKEN_PATTERN = /<PII:([A-Z_]+):(\d+)>/g;

const ERROR_TITLES: Partial<Record<ErrorCode, string>> = {
  GOAL_NOT_ACHIEVED: "Couldn't do that here",
  PLANNER_ERROR: "The planning server had a problem",
  CONTENT_SCRIPT_ERROR: "Can't work on this tab",
  OBSERVATION_FAILED: "Couldn't read this page",
  NO_PROGRESS: "Stuck",
  MAX_STEPS_REACHED: "Step limit reached",
  TASK_TIMEOUT: "Took too long",
  PII_TRIPWIRE: "Stopped to protect your data",
  NAME_DETECTION_FAILED: "Stopped to protect your data",
};

const PHASE_WORDS: Record<TaskItem["phase"], string> = {
  starting: "Starting",
  reading: "Reading the page",
  planning: "Deciding the next step",
  acting: "Acting",
  done: "",
};

function quote(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return `“${text.length > 60 ? `${text.slice(0, 57)}…` : text}”`;
}

function describeAction(action: Action, targetLabel?: string): string {
  const target = quote(targetLabel) ?? ("target" in action && action.target ? `element ${action.target}` : "the page");
  switch (action.type) {
    case "click": return `Click ${target}`;
    case "type": return `Type ${action.value} into ${target}${action.submit ? " and press Enter" : ""}`;
    case "select": return `Choose ${quote(action.value)} in ${target}`;
    case "scroll": return `Scroll ${action.direction}${action.target ? ` in ${target}` : ""}`;
    case "navigate": return action.to === "back" ? "Go back" : `Open ${action.to}`;
    case "extract": return `Read ${target}`;
    case "wait": return `Wait ${(action.ms / 1000).toFixed(1)} s`;
    case "done": return "Finish";
  }
}

const ACTION_ICONS: Record<Action["type"], LucideIcon> = {
  click: MousePointer2, type: Keyboard, select: ChevronsUpDown, scroll: ArrowDownUp, navigate: ArrowRight, extract: ScanText, wait: Clock, done: CircleCheck,
};

const ICON_SIZE = 16;

function describeCounts(counts: RedactionCounts): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n && n > 0)
    .map(([category, n]) => `${n} ${CATEGORY_WORDS[category as PiiCategory][n === 1 ? 0 : 1]}`);
  return parts.join(", ");
}

/**
 * A placeholder in the answer whose real value is on this device. It shows as
 * the placeholder; a click shows the value, here only, and another hides it.
 * Nothing is sent: the value never left the device.
 */
function RevealToken({ label, word, value }: { label: string; word: string; value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      className="token token-reveal"
      aria-pressed={shown}
      onClick={() => setShown((now) => !now)}
      title={shown ? "Shown only here; the server never saw it. Click to hide." : `The server only saw "${label}". Click to show your ${word} here; nothing is sent.`}
    >
      {shown ? value : label}
      {shown ? <EyeOff className="icon" size={12} aria-hidden="true" /> : <Eye className="icon" size={12} aria-hidden="true" />}
    </button>
  );
}

/**
 * Shows text with each PII token as a labelled pill. Given the real values
 * (the final answer only), a pill can be clicked to show its value.
 */
function Tokenised({ text, values }: { text: string; values?: ReadonlyMap<string, string> }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const category = match[1] as PiiCategory;
    const word = CATEGORY_WORDS[category]?.[0] ?? "private value";
    const value = values?.get(match[0]);
    parts.push(value === undefined
      ? <span className="token" key={index} title={`Your ${word}, kept on this device`}>{word} {match[2]}</span>
      : <RevealToken key={index} label={`${word} ${match[2]}`} word={word} value={value} />);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// ─── Pieces ────────────────────────────────────────────────────────────────

function ServerChip({ info, onRetry }: { info: ServerInfo | null | "checking"; onRetry: () => void }) {
  if (info === "checking") return <span className="chip"><span className="chip-label">Connecting…</span></span>;
  if (!info) {
    return (
      <button className="chip chip-bad" type="button" onClick={onRetry} title={`No planning server at ${SERVER_URL}. Start it with: pnpm dev:server`}>
        <span className="dot" /> <span className="chip-label">Server offline · retry</span>
      </button>
    );
  }
  return (
    <span className="chip" title={`Planning server at ${SERVER_URL}`}>
      <span className="dot dot-ok" /> <span className="chip-label">{info.model.split("/").pop()} · {info.provider}</span>
    </span>
  );
}

function StepRow({ step }: { step: StepView }) {
  const ActionIcon = ACTION_ICONS[step.action.type];
  const status = step.verified === undefined ? "pending" : step.verified ? "ok" : "warn";
  const reason = "reason" in step.action ? step.action.reason : undefined;
  return (
    <li className={`step step-${status}`}>
      <span className="step-icon" aria-hidden="true"><ActionIcon className="icon" size={ICON_SIZE} /></span>
      <div className="step-body">
        <div className="step-title"><Tokenised text={describeAction(step.action, step.targetLabel)} /></div>
        {reason && <div className="step-reason"><Tokenised text={reason} /></div>}
        {step.verified === false && <div className="step-note"><Tokenised text={step.message ?? "Not confirmed."} /></div>}
      </div>
      <span className="step-meta">
        {step.verified === undefined ? <span className="spinner" aria-label="Working" /> : step.verified ? <CircleCheck className="icon" size={ICON_SIZE} aria-label="Done" /> : <AlertTriangle className="icon" size={ICON_SIZE} aria-label="Not confirmed" />}
        <small>{(step.latencyMs / 1000).toFixed(1)} s</small>
      </span>
    </li>
  );
}

function wordFor(token: PiiToken): string {
  return CATEGORY_WORDS[categoryOf(token)]?.[0] ?? "private value";
}

/** "an ID number", "a card number". */
function withArticle(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

const CONCERN_WORDS: Record<Concern, (word: string) => string> = {
  "not-asked": (word) => `Your request didn't mention your ${word}.`,
  "other-site": () => "It came from a different site.",
  sensitive: (word) => `Skrim always checks before typing ${withArticle(word)}.`,
};

/**
 * The data guard's question (lib/agent/data-guard.ts): may this step type
 * these values here? A placeholder can be clicked to show its real value, on
 * this device only. The task waits for the answer.
 */
function AskCard({ open }: { open: OpenQuestion }) {
  const { question, values, answer } = open;
  const words = [...new Set(question.asks.map(({ token }) => wordFor(token)))];
  const reasons = [...new Set(question.asks.map(({ token, concern }) => CONCERN_WORDS[concern](wordFor(token))))];
  return (
    <div className="ask" role="group" aria-label="Skrim needs your permission">
      <div className="ask-title"><ShieldAlert className="icon" size={ICON_SIZE} aria-hidden="true" /> Use your {words.join(" and ")} here?</div>
      <p>
        The planner wants to type <Tokenised text={question.asks.map(({ token }) => token).join(" and ")} values={values} /> into{" "}
        <Tokenised text={quote(question.field) ?? "a field"} /> on {hostOf(question.site) ?? question.site}.
      </p>
      {reasons.map((reason) => <p key={reason} className="ask-why">{reason}</p>)}
      <div className="ask-actions">
        <button type="button" className="ask-allow" onClick={() => answer(true)}>Allow</button>
        <button type="button" className="ask-deny" onClick={() => answer(false)}>Don't allow</button>
      </div>
    </div>
  );
}

const ONE_TOKEN = /<PII:[A-Z_]+:\d+>/;

/** Steps that typed a personal value, for the Privacy record. */
function typedSteps(steps: StepView[]): Array<StepView & { action: Extract<Action, { type: "type" }> }> {
  return steps.filter((step): step is StepView & { action: Extract<Action, { type: "type" }> } =>
    step.action.type === "type" && step.verified === true && ONE_TOKEN.test(step.action.value));
}

/** How the task ended, with what stayed on the device one click away rather than under every answer. */
function ResultCard({ finished, answerValues, steps }: { finished: Finished; answerValues?: ReadonlyMap<string, string>; steps: StepView[] }) {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const kept = describeCounts(finished.tokens);
  const typed = typedSteps(steps);
  return (
    <div className={`result result-${finished.outcome}`}>
      {finished.outcome === "completed" && <div className="result-title"><CircleCheck className="icon" size={ICON_SIZE} aria-hidden="true" /> Done</div>}
      {finished.outcome === "cancelled" && <div className="result-title"><Square className="icon" size={ICON_SIZE} aria-hidden="true" /> Stopped</div>}
      {finished.outcome === "failed" && <div className="result-title"><AlertTriangle className="icon" size={ICON_SIZE} aria-hidden="true" /> {ERROR_TITLES[finished.errorCode ?? "CONTENT_SCRIPT_ERROR"] ?? "Something went wrong"}</div>}
      {finished.summary && <p><Tokenised text={finished.summary} values={answerValues} /></p>}
      {finished.message && <p>{finished.message}</p>}
      <div className="result-foot">
        <small title={finished.errorCode}>
          {finished.steps} step{finished.steps === 1 ? "" : "s"}
        </small>
        <button className="info-button" type="button" onClick={() => setShowPrivacy((shown) => !shown)} aria-expanded={showPrivacy} title="What stayed on this device">
          <ShieldCheck className="icon" size={14} aria-hidden="true" /> Privacy
        </button>
      </div>
      {showPrivacy && (
        <div className="privacy-detail">
          <ShieldCheck className="icon" size={ICON_SIZE} aria-hidden="true" />
          <div>
            <p>{kept ? `Kept on this device: ${kept}. The server only saw placeholders.` : "No personal data found on these pages."}</p>
            {typed.length > 0 && (
              <>
                <p>Typed into pages, by this device:</p>
                <ul>
                  {typed.map((step) => (
                    <li key={step.step}>
                      <Tokenised text={step.action.value.match(new RegExp(ONE_TOKEN, "g"))!.join(", ")} /> into <Tokenised text={quote(step.targetLabel) ?? "a field"} />
                      {step.site ? ` on ${step.site}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskView({ task }: { task: TaskItem }) {
  const { finished } = task;
  const showRedactedGoal = task.redactedGoal && task.redactedGoal !== task.goal;
  return (
    <section className="turn">
      <div className="bubble-user">{task.goal}</div>
      <div className="agent">
        {showRedactedGoal && (
          <p className="sent-as">Sent to the server as: <Tokenised text={task.redactedGoal!} /></p>
        )}
        {task.warnings.map((warning) => <p key={warning} className="note note-error">{warning}</p>)}
        {task.steps.length > 0 && <ol className="steps">{task.steps.map((step) => <StepRow key={step.step} step={step} />)}</ol>}
        {task.question && <AskCard open={task.question} />}
        {task.phase !== "done" && !task.question && (
          <div className="working"><span className="spinner" aria-hidden="true" /> {PHASE_WORDS[task.phase]}…</div>
        )}
        {finished && <ResultCard finished={finished} answerValues={task.answerValues} steps={task.steps} />}
      </div>
    </section>
  );
}

/**
 * GLiNER finds names and addresses. Loaded on demand, so ONNX Runtime stays out
 * of the panel's first paint.
 */
const findNames: NameFinder = async (texts) => {
  const { loadNameFinder } = await import("@/lib/pii/ner-browser.ts");
  const finder = await loadNameFinder();
  return texts.length === 0 ? [] : finder(texts);
};

const MAX_INPUT_HEIGHT = 160;

const EXAMPLES = ["Click the first link on this page", "Search this site for wireless headphones", "Tick the checkbox and continue"];

// ─── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [server, setServer] = useState<ServerInfo | null | "checking">("checking");
  const [siteAccess, setSiteAccess] = useState<boolean | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const checkServer = useCallback(async () => {
    setServer("checking");
    setServer(await fetchServerInfo(SERVER_URL));
  }, []);

  useEffect(() => {
    void hasSiteAccess().then(setSiteAccess);
  }, []);

  const allowSites = () => {
    // Must run straight from the click: Firefox asks only during a user action.
    void browser.permissions.request({ origins: ["<all_urls>"] }).then(setSiteAccess, () => setSiteAccess(false));
  };

  useEffect(() => {
    void checkServer();
    // Start loading the name model now, so the first task does not wait for it.
    findNames([]).catch(() => {});
    // Closing the panel ends the task: the loop and its vault live here.
    return () => controllerRef.current?.abort();
  }, [checkServer]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`;
    // A scrollbar only once the text outgrows the box. Before that, a
    // fraction of a pixel of rounding showed its arrows on a one-line box.
    input.style.overflowY = input.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  const start = async (text: string) => {
    const goal = text.trim();
    const planner = getActionPlanner();
    if (!goal || running || !planner) return;
    setDraft("");
    const id = nextId.current++;
    setItems((current) => [...current, { kind: "task", id, goal, phase: "starting", steps: [], warnings: [] }]);
    const update = (event: AgentEvent) =>
      setItems((current) => current.map((item) => (item.id === id ? applyEvent(item, event) : item)));

    // A side panel works on the tab in front; a panel opened as its own tab
    // (Firefox for Android) on the tab it was opened from.
    const tab = PANEL_TARGET === undefined
      ? (await browser.tabs.query({ active: true, currentWindow: true }))[0]
      : await browser.tabs.get(PANEL_TARGET).catch(() => undefined);
    if (tab?.id === undefined) {
      const message = PANEL_TARGET === undefined
        ? "There is no tab to work on."
        : "The page Skrim was opened from is closed. Open Skrim again from the page you want it to work on.";
      update({ type: "finished", outcome: "failed", steps: 0, tokens: {}, errorCode: "CONTENT_SCRIPT_ERROR", message });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    try {
      await runAgentTask({ goal, planner, link: tabLink(tab.id), signal: controller.signal, onEvent: (e) => { update(e); feed.onEvent(e); }, findNames, readPixels: tabPixelReader(tab.id),
        onAnswerValues: (values) => setItems((current) => current.map((item) => (item.id === id ? { ...item, answerValues: values } : item))),
        // The data guard's question waits in the chat until it is answered,
        // or the task ends: stopping it, or closing the panel, refuses.
        confirmDataUse: (question, values, signal) => new Promise<boolean>((resolve) => {
          const setQuestion = (open: OpenQuestion | undefined) => setItems((current) => current.map((item) => {
            if (item.id !== id) return item;
            const { question: _closed, ...rest } = item;
            return open ? { ...rest, question: open } : rest;
          }));
          signal.addEventListener("abort", () => setQuestion(undefined), { once: true });
          setQuestion({ question, values, answer: (allowed) => { setQuestion(undefined); resolve(allowed); } });
        }) });
    } finally {
      controllerRef.current = null;
      setRunning(false);
      void checkServer();
    }
  };

  const stop = () => controllerRef.current?.abort();

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void start(draft);
    }
    if (event.key === "Escape" && running) stop();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="mark" aria-hidden="true"><ShieldCheck className="icon" size={16} strokeWidth={2.25} /></span>Skrim</div>
        <ServerChip info={server} onRetry={() => void checkServer()} />
        <div className="topbar-actions">
          <button className="icon-button" type="button" onClick={() => setItems([])} disabled={running || items.length === 0} title="Clear the chat" aria-label="Clear the chat"><Eraser className="icon" size={ICON_SIZE} /></button>
        </div>
      </header>

      <main className="chat">
        {siteAccess === false && (
          <div className="notice" role="alert">
            <p>Skrim needs access to the pages you ask it to work on. Firefox has not given it yet.</p>
            <button type="button" className="notice-button" onClick={allowSites}>Allow on all sites</button>
          </div>
        )}
        {items.length === 0 && (
          <div className="empty">
            <div className="empty-mark" aria-hidden="true"><ShieldCheck className="icon" size={24} /></div>
            <h1>What should I do on this page?</h1>
            <p>Skrim reads the page on your device, swaps personal details for placeholders, and asks the planning server for one step at a time.</p>
            {PANEL_TARGET !== undefined && <p>It works on the tab you opened it from. Switch back to that tab to watch, and here to see each step.</p>}
            <div className="examples">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => { setDraft(example); inputRef.current?.focus(); }}>{example}<ArrowRight className="icon" size={14} aria-hidden="true" /></button>
              ))}
            </div>
            <p className="fine">Nothing is saved. Closing this panel stops the task and clears the chat.</p>
          </div>
        )}
        {items.map((item) => <TaskView key={item.id} task={item} />)}
        <div ref={endRef} />
      </main>

      <footer className="composer">
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={running ? "Working… press Esc to stop" : "Tell Skrim what to do on this page"}
          disabled={running}
          aria-label="Task for Skrim"
        />
        {running
          ? <button className="send stop" type="button" onClick={stop} aria-label="Stop" title="Stop (Esc)"><Square className="icon" size={14} fill="currentColor" /></button>
          : <button className="send" type="button" onClick={() => void start(draft)} disabled={!draft.trim()} aria-label="Send" title="Send (Enter)"><ArrowUp className="icon" size={18} strokeWidth={2.25} /></button>}
      </footer>
    </div>
  );
}
