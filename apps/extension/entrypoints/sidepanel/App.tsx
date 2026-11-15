import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Action, PiiCategory, PiiToken } from "@skrim/schema";
import { AlertTriangle, ArrowDownUp, ArrowRight, ArrowUp, Check, ChevronsUpDown, CircleAlert, CircleCheck, Clock, Download, Eraser, Eye, EyeOff, Keyboard, MousePointer2, ScanText, Settings, ShieldCheck, Square, type LucideIcon } from "lucide-react";
import type { ErrorCode } from "@/lib/errors.ts";
import { runAgentTask, type AgentEvent, type DataUseQuestion, type TaskPermissions } from "@/lib/agent/loop.ts";
import { categoryOf, type Concern } from "@/lib/agent/data-guard.ts";
import { withDashboardFeed } from "@/lib/agent/dashboard-feed.ts";
import type { RedactionCounts } from "@/lib/agent/redact.ts";
import type { NameFinder } from "@/lib/pii/gliner.ts";
import { fetchServerInfo, createServerPlanner, type ServerInfo } from "@/lib/agent/server-planner.ts";
import { tabLink } from "@/lib/agent/tab-link.ts";
import { panelTargetFromUrl } from "@/lib/agent/panel-target.ts";
import { tabPixelReader } from "@/lib/vision/read-pixels.ts";
import { SERVER_URL } from "./config.ts";
import { feed } from "./feed-instance.ts";
import "@fontsource-variable/sora";
import "@fontsource-variable/dm-sans";
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
  /** Redactions observed at this step (from the preceding "observed" event). */
  redactions?: RedactionCounts;
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
  /** TASK_07: structured event log for audit / download. */
  auditLog: AgentEvent[];
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

/** TASK_05: Patterns that look like injected instructions in the goal. */
const INJECTION_PATTERNS: RegExp[] = [
  // Ignore / disregard / override — fixed to allow multiple modifiers ("all previous")
  /ignore (?:(?:all|previous|prior|above|the|your)\s+)*instructions?/i,
  /disregard (?:(?:all|previous|prior|the|your)\s+)*instructions?/i,
  /override (?:(?:all|previous|prior|the|your)\s+)*instructions?/i,
  // Forget / reset
  /forget (?:everything|what you were told|your instructions|your previous|all previous)/i,
  // New task / directive smuggled inline
  /new (?:task|instruction|directive|goal|objective)\s*:/i,
  // System prompt references
  /system\s*[:\-]\s*(?:prompt|message|instruction)/i,
  // Role hijacking
  /\byou are now\b/i,
  /\byou are (?:a |an )?(?:different|new|another|evil|uncensored)/i,
  /\bact as\b.{0,40}\b(?:assistant|ai|model|gpt|llm|bot)\b/i,
  /\bpretend (?:you are|to be)\b/i,
  /\broleplay as\b/i,
  // DAN / jailbreak keywords
  /\bdan mode\b/i,
  /\bjailbreak\b/i,
  /\bdo anything now\b/i,
  /\buncensored mode\b/i,
  /\bdeveloper mode\b/i,
  /\badmin mode\b/i,
  // Prompt prefix smuggling
  /\bPROMPT\s*:/i,
  /\bINSTRUCTION\s*:/i,
  /\[\s*system\s*\]/i,
  // Base64 / encoding hints (common obfuscation vector)
  /decode (?:the following|this|and execute)/i,
  /execute (?:the following|this) (?:code|command|instruction)/i,
];


const MAX_GOAL_LENGTH = 500;

/**
 * TASK_05: Detect likely prompt-injection attempts in the user's goal string.
 * Returns a warning string if suspicious, otherwise undefined.
 * This is a deterministic content check — not a model decision.
 */
function detectInjection(goal: string): string | undefined {
  if (goal.length > MAX_GOAL_LENGTH) return `Goal is too long (${goal.length} characters). Keep it under ${MAX_GOAL_LENGTH} to prevent injection attempts.`;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(goal)) return "That goal looks like it contains instructions for the AI rather than a task for Skrim. Please describe what you want done on this page.";
  }
  return undefined;
}

function applyEvent(task: TaskItem, event: AgentEvent): TaskItem {
  // TASK_07: append every event to the audit log.
  const auditLog = [...task.auditLog, event];
  switch (event.type) {
    case "started":
      return { ...task, auditLog, redactedGoal: event.redactedGoal, phase: "reading" };
    case "observed":
      // TASK_06: stash the latest redaction counts so the next planned step can show them.
      return { ...task, auditLog, phase: "planning", redactions: event.redactions, page: event.page };
    case "planned":
      if (event.action.type === "done") return { ...task, auditLog };
      // TASK_06: attach the current redaction snapshot to the step being added.
      return { ...task, auditLog, phase: "acting", steps: [...task.steps, { step: event.step, action: event.action, targetLabel: event.targetLabel, latencyMs: event.latencyMs, site: hostOf(task.page), redactions: task.redactions }] };
    case "acted":
      return { ...task, auditLog, phase: "reading", steps: task.steps.map((s) => (s.step === event.step ? { ...s, verified: event.verified, message: event.message } : s)) };
    case "warning":
      return { ...task, auditLog, warnings: [...task.warnings, event.message] };
    case "finished":
      return { ...task, auditLog, phase: "done", finished: event };
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

/** TASK_02: Human labels for each action type in the Rules panel. */
const ACTION_LABELS: Record<Action["type"], string> = {
  click: "Click", type: "Type", select: "Choose option", scroll: "Scroll",
  navigate: "Navigate", extract: "Read value", wait: "Wait", done: "Finish",
};

/** TASK_02: All 8 action types in display order. */
const ALL_ACTION_TYPES: Action["type"][] = ["click", "type", "scroll", "select", "navigate", "extract", "wait", "done"];

/** TASK_02: Default permissions — all actions enabled. */
const DEFAULT_PERMISSIONS: TaskPermissions = { allowedActions: [...ALL_ACTION_TYPES] };

/** Model catalog shown in the settings dropdown. */
const KNOWN_MODELS: { label: string; value: string; provider: string; needsKey: boolean }[] = [
  // ── Server default ──────────────────────────────────────────────
  { label: "Server default", value: "", provider: "server", needsKey: false },
  // ── Groq (free-tier, OpenAI-compatible) ─────────────────────────
  { label: "Qwen 3.8-27B  ·  Groq", value: "groq:qwen/qwen3.8-27b", provider: "groq", needsKey: true },
  { label: "Llama 3.3 70B  ·  Groq", value: "groq:llama-3.3-70b-versatile", provider: "groq", needsKey: true },
  { label: "Llama 3.1 8B  ·  Groq", value: "groq:llama-3.1-8b-instant", provider: "groq", needsKey: true },
  // ── Cerebras (the same Qwen, its own free allowance) ─────────────
  { label: "Qwen 3.8-27B  ·  Cerebras", value: "cerebras:qwen-3.8-27b", provider: "cerebras", needsKey: true },
  // ── NVIDIA NIM ──────────────────────────────────────────────────
  { label: "Nemotron-3 120B  ·  NVIDIA", value: "nvidia:nvidia/nemotron-3-super-120b-a12b", provider: "nvidia", needsKey: true },
  // ── Ollama (local, no key) ───────────────────────────────────────
  { label: "skrim-planner  ·  Ollama (local)", value: "ollama:skrim-planner", provider: "ollama", needsKey: false },
  { label: "Qwen3-VL 4B (previous)  ·  Ollama (local)", value: "ollama:skrim-planner-vl", provider: "ollama", needsKey: false },
  { label: "Llama 3.2 3B  ·  Ollama (local)", value: "ollama:llama3.2:3b", provider: "ollama", needsKey: false },
];

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

/** Skrim's mark, "dot, dash": you, and the placeholder that goes in your place. */
function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="11" cy="24" r="7" fill="currentColor" />
      <rect x="22" y="18" width="23" height="12" rx="6" fill="var(--pen)" />
    </svg>
  );
}

function ServerChip({ info, onRetry }: { info: ServerInfo | null | "checking"; onRetry: () => void }) {
  if (info === "checking") return <span className="chip"><span className="chip-label">connecting…</span></span>;
  if (!info) {
    return (
      <button className="chip chip-bad" type="button" onClick={onRetry} title={`No planning server at ${SERVER_URL}. Start it with: pnpm dev:server`}>
        <span className="dot" /> <span className="chip-label">server offline · retry</span>
      </button>
    );
  }
  return (
    <span className="chip" title={`Planning server at ${SERVER_URL}`}>
      <span className="dot dot-ok" /> <span className="chip-label">{info.model.split("/").pop()} · {info.provider}</span>
    </span>
  );
}

/** One step as a log line: status, what it did, how long the planner took. */
function StepLine({ step, hid }: { step: StepView; hid?: string }) {
  const status = step.verified === undefined ? "pending" : step.verified ? "ok" : "warn";
  const reason = "reason" in step.action ? step.action.reason : undefined;
  return (
    <li className={`line line-${status}`} title={reason}>
      <span className="glyph" aria-label={status === "pending" ? "Working" : status === "ok" ? "Done" : "Not confirmed"}>
        {status === "pending" ? <span className="spinner" /> : status === "ok" ? <Check className="icon" size={12} strokeWidth={3} /> : <CircleAlert className="icon" size={12} strokeWidth={2.5} />}
      </span>
      <span className="line-text"><Tokenised text={describeAction(step.action, step.targetLabel)} /></span>
      <span className="line-time">{(step.latencyMs / 1000).toFixed(1)}s</span>
      {step.verified === false && <span className="line-sub line-sub-warn"><Tokenised text={step.message ?? "Not confirmed."} /></span>}
      {hid && <span className="line-sub">hid {hid}</span>}
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
 * The data guard's question (lib/agent/data-guard.ts), as a prompt in the
 * log: may this step type these values here? A placeholder can be clicked to
 * show its real value, on this device only. A and D answer from the keyboard.
 * The task waits for the answer.
 */
function AskPrompt({ open }: { open: OpenQuestion }) {
  const { question, values, answer } = open;
  const words = [...new Set(question.asks.map(({ token }) => wordFor(token)))];
  const reasons = [...new Set(question.asks.map(({ token, concern }) => CONCERN_WORDS[concern](wordFor(token))))];
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select") || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "a" || event.key === "A") { event.preventDefault(); answer(true); }
      if (event.key === "d" || event.key === "D") { event.preventDefault(); answer(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer]);
  return (
    <div className="ask" role="group" aria-label="Skrim needs your permission">
      <div className="ask-title"><span className="ask-q" aria-hidden="true">?</span> Use your {words.join(" and ")} here?</div>
      <p>
        Type <Tokenised text={question.asks.map(({ token }) => token).join(" and ")} values={values} /> into{" "}
        <Tokenised text={quote(question.field) ?? "a field"} /> on {hostOf(question.site) ?? question.site}.
      </p>
      {reasons.map((reason) => <p key={reason} className="ask-why">{reason}</p>)}
      <div className="ask-actions">
        <button type="button" className="ask-allow" onClick={() => answer(true)}><kbd>A</kbd> Allow</button>
        <button type="button" className="ask-deny" onClick={() => answer(false)}><kbd>D</kbd> Don't allow</button>
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

/** How the task ended: one closing log line, the answer, and what stayed on the device one click away. */
function ResultBlock({ finished, answerValues, steps, onAudit }: { finished: Finished; answerValues?: ReadonlyMap<string, string>; steps: StepView[]; onAudit: () => void }) {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const kept = describeCounts(finished.tokens);
  const typed = typedSteps(steps);
  const title = finished.outcome === "completed" ? "Done"
    : finished.outcome === "cancelled" ? "Stopped"
    : (ERROR_TITLES[finished.errorCode ?? "CONTENT_SCRIPT_ERROR"] ?? "Something went wrong");
  return (
    <div className={`result result-${finished.outcome}`}>
      <div className="result-line">
        <span className="glyph" aria-hidden="true">{finished.outcome === "completed" ? <Square className="icon" size={10} fill="currentColor" /> : finished.outcome === "cancelled" ? <Square className="icon" size={10} /> : <AlertTriangle className="icon" size={12} />}</span>
        <span className="result-title">{title}</span>
        <span className="line-time" title={finished.errorCode}>{finished.steps} step{finished.steps === 1 ? "" : "s"}</span>
      </div>
      {finished.summary && <p className="result-text"><Tokenised text={finished.summary} values={answerValues} /></p>}
      {finished.message && <p className="result-text">{finished.message}</p>}
      <div className="result-foot">
        <button className="text-button" type="button" onClick={() => setShowPrivacy((shown) => !shown)} aria-expanded={showPrivacy} title="What stayed on this device">
          <ShieldCheck className="icon" size={12} aria-hidden="true" /> Privacy
        </button>
        <button className="text-button" type="button" onClick={onAudit} title="Download every step of this task as JSON (placeholders only)">
          <Download className="icon" size={12} aria-hidden="true" /> Audit log
        </button>
      </div>
      {showPrivacy && (
        <div className="privacy-detail">
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
      )}
    </div>
  );
}

/** A task as one log: what you asked, what the server saw, each step, then how it ended. */
function TaskView({ task, onAudit }: { task: TaskItem; onAudit: () => void }) {
  const { finished } = task;
  const showRedactedGoal = task.redactedGoal && task.redactedGoal !== task.goal;
  // TASK_06: what was hidden on the page, shown on a step only when it changed since the step before.
  let previous = "";
  const hidAt = task.steps.map((step) => {
    const now = step.redactions ? describeCounts(step.redactions) : "";
    const changed = now !== previous;
    previous = now;
    return changed && now ? now : undefined;
  });
  return (
    <section className="turn">
      <div className="goal"><span className="prompt" aria-hidden="true">›</span><span>{task.goal}</span></div>
      {showRedactedGoal && (
        <p className="sent-as"><span className="sent-label">server saw</span> <Tokenised text={task.redactedGoal!} /></p>
      )}
      {task.warnings.map((warning) => <p key={warning} className="note note-error">{warning}</p>)}
      {task.steps.length > 0 && <ol className="log">{task.steps.map((step, i) => <StepLine key={step.step} step={step} hid={hidAt[i]} />)}</ol>}
      {task.question && <AskPrompt open={task.question} />}
      {task.phase !== "done" && !task.question && (
        <div className="working"><span className="caret" aria-hidden="true" />{PHASE_WORDS[task.phase]}…</div>
      )}
      {finished && <ResultBlock finished={finished} answerValues={task.answerValues} steps={task.steps} onAudit={onAudit} />}
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
  // TASK_02: user-controlled action permissions; default = everything on.
  const [permissions, setPermissions] = useState<TaskPermissions>(DEFAULT_PERMISSIONS);
  // TASK_03: session-scoped server URL override (not persisted; resets on panel close).
  const [runtimeServerUrl, setRuntimeServerUrl] = useState(SERVER_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [goalError, setGoalError] = useState<string | undefined>(undefined);
  // Model selector: value from KNOWN_MODELS, empty = server default.
  const [selectedModelValue, setSelectedModelValue] = useState("");
  const [apiKey, setApiKey] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const checkServer = useCallback(async () => {
    setServer("checking");
    setServer(await fetchServerInfo(runtimeServerUrl));
  }, [runtimeServerUrl]);

  // TASK_02: toggle a single action type on/off (keep modelOverride + customInstructions).
  const toggleAction = (type: Action["type"]) => {
    setPermissions((prev) => {
      const on = prev.allowedActions.includes(type);
      if (type === "done") return prev;
      return { ...prev, allowedActions: on ? prev.allowedActions.filter((a) => a !== type) : [...prev.allowedActions, type] };
    });
  };

  // TASK_07: download the audit log for a task as a JSON file.
  const downloadAuditLog = (task: TaskItem) => {
    const blob = new Blob([JSON.stringify({ goal: task.goal, redactedGoal: task.redactedGoal, events: task.auditLog }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `skrim-audit-task-${task.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
    findNames([]).catch(() => { });
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
    // TASK_03: use the runtime server URL to build the planner.
    // Wrapped for the dashboard, like the planner main.tsx registers: it shows
    // each request as the server got it. The user's key rides in a header.
    const planner = withDashboardFeed(createServerPlanner(runtimeServerUrl, apiKey.trim() || undefined), feed);
    if (!goal || running) return;
    // TASK_05: deterministic injection guard before the loop starts.
    const injectionWarning = detectInjection(goal);
    if (injectionWarning) { setGoalError(injectionWarning); return; }
    setGoalError(undefined);
    setShowSettings(false);
    setDraft("");
    const id = nextId.current++;
    // TASK_07: initialise auditLog array for this task.
    setItems((current) => [...current, { kind: "task", id, goal, phase: "starting", steps: [], warnings: [], auditLog: [] }]);
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
    // "provider:model" (empty = the server's own). The key never goes in the
    // request: createServerPlanner sends it as a header.
    const taskPermissions: TaskPermissions = { ...permissions, ...(selectedModelValue ? { modelOverride: selectedModelValue } : {}) };
    try {
      await runAgentTask({ goal, planner, link: tabLink(tab.id), signal: controller.signal, onEvent: (e) => { update(e); feed.onEvent(e); }, findNames, readPixels: tabPixelReader(tab.id),
        permissions: taskPermissions,
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
        <div className="brand"><Mark size={20} />Skrim</div>
        <ServerChip info={server} onRetry={() => void checkServer()} />
        <div className="topbar-actions">
          {/* TASK_02 + TASK_03: Settings panel toggle */}
          <button className="icon-button" type="button" onClick={() => setShowSettings((s) => !s)} title="Rules &amp; settings" aria-label="Rules and settings" aria-expanded={showSettings}><Settings className="icon" size={ICON_SIZE} /></button>
          <button className="icon-button" type="button" onClick={() => setItems([])} disabled={running || items.length === 0} title="Clear the chat" aria-label="Clear the chat"><Eraser className="icon" size={ICON_SIZE} /></button>
        </div>
      </header>

      {/* TASK_02 + TASK_03: settings, one compact row each; it closes when a task starts. */}
      {showSettings && (
        <div className="settings-panel" role="region" aria-label="Rules and settings">
          <div className="settings-row">
            <span className="settings-label">Allowed</span>
            <div className="settings-toggles">
              {ALL_ACTION_TYPES.filter((t) => t !== "done").map((type) => {
                const ActionIcon = ACTION_ICONS[type];
                const enabled = permissions.allowedActions.includes(type);
                return (
                  <label key={type} className={`action-toggle ${enabled ? "action-toggle-on" : "action-toggle-off"}`} title={enabled ? `${ACTION_LABELS[type]} is allowed` : `${ACTION_LABELS[type]} is blocked`}>
                    <input type="checkbox" checked={enabled} onChange={() => toggleAction(type)} disabled={running} />
                    <ActionIcon className="icon" size={12} aria-hidden="true" />
                    {ACTION_LABELS[type]}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="model-select">Model</label>
            <select id="model-select" className="settings-input" value={selectedModelValue} onChange={(e) => { setSelectedModelValue(e.target.value); setApiKey(""); }} disabled={running}>
              {KNOWN_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          {KNOWN_MODELS.find((m) => m.value === selectedModelValue)?.needsKey && (
            <div className="settings-row">
              <label className="settings-label" htmlFor="api-key">Key</label>
              <input id="api-key" className="settings-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={running} placeholder="Yours, or blank for the server's" title="Kept in memory only, sent as a header, never shown on the dashboard" autoComplete="off" spellCheck={false} />
            </div>
          )}
          <div className="settings-row settings-row-top">
            <label className="settings-label" htmlFor="custom-instructions">Rules</label>
            <textarea id="custom-instructions" className="settings-input" rows={2} value={permissions.customInstructions ?? ""} onChange={(e) => setPermissions((prev) => ({ ...prev, customInstructions: e.target.value }))} disabled={running} placeholder="e.g. Never click sponsored links" title="Sent to the planner with every step, personal data hidden like the goal" spellCheck={false} />
          </div>
          <div className="settings-row">
            <label className="settings-label" htmlFor="server-url-input">Server</label>
            <div className="settings-url-row">
              <input id="server-url-input" className="settings-input settings-mono" type="url" value={runtimeServerUrl} onChange={(e) => setRuntimeServerUrl(e.target.value.trim())} disabled={running} placeholder={SERVER_URL} title="Resets when this panel closes" spellCheck={false} autoComplete="off" />
              <button className="settings-url-check" type="button" onClick={() => void checkServer()} disabled={running} title="Test connection">Test</button>
            </div>
          </div>
        </div>
      )}

      <main className="chat">
        {siteAccess === false && (
          <div className="notice" role="alert">
            <p>Skrim needs access to the pages you ask it to work on. Firefox has not given it yet.</p>
            <button type="button" className="notice-button" onClick={allowSites}>Allow on all sites</button>
          </div>
        )}
        {goalError && (
          <div className="notice" role="alert">
            <p>{goalError}</p>
            <button type="button" className="notice-button" onClick={() => setGoalError(undefined)}>Dismiss</button>
          </div>
        )}
        {items.length === 0 && !goalError && (
          <div className="empty">
            <Mark size={40} />
            <h1>What should I do on this page?</h1>
            <p>Skrim reads the page on your device and blacks out your personal details. The planner gets the page with <span className="token">name 1</span> where your name was, and plans one step at a time.</p>
            {PANEL_TARGET !== undefined && <p>It works on the tab you opened it from. Switch back to that tab to watch, and here to see each step.</p>}
            <div className="examples">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => { setDraft(example); inputRef.current?.focus(); }}><span className="prompt" aria-hidden="true">›</span>{example}<ArrowRight className="icon" size={14} aria-hidden="true" /></button>
              ))}
            </div>
            <p className="fine">Nothing is saved. Closing this panel stops the task and clears it.</p>
          </div>
        )}
        {items.map((item) => <TaskView key={item.id} task={item} onAudit={() => downloadAuditLog(item)} />)}
        <div ref={endRef} />
      </main>

      <footer className="composer">
        <span className="prompt" aria-hidden="true">›</span>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          onChange={(event) => { setDraft(event.target.value); if (goalError) setGoalError(undefined); }}
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
