import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Action, PiiCategory } from "@skrim/schema";
import { AlertTriangle, ArrowDownUp, ArrowRight, ArrowUp, ChevronsUpDown, CircleCheck, Clock, Download, Eraser, Keyboard, MousePointer2, ScanText, Settings, ShieldCheck, Square, type LucideIcon } from "lucide-react";
import type { ErrorCode } from "@/lib/errors.ts";
import { runAgentTask, type AgentEvent, type TaskPermissions } from "@/lib/agent/loop.ts";
import type { RedactionCounts } from "@/lib/agent/redact.ts";
import type { NameFinder } from "@/lib/pii/gliner.ts";
import { fetchServerInfo, createServerPlanner, type ServerInfo } from "@/lib/agent/server-planner.ts";
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
  /** Redactions observed at this step (from the preceding "observed" event). */
  redactions?: RedactionCounts;
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
  /** TASK_07: structured event log for audit / download. */
  auditLog: AgentEvent[];
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
      return { ...task, auditLog, phase: "planning", redactions: event.redactions };
    case "planned":
      if (event.action.type === "done") return { ...task, auditLog };
      // TASK_06: attach the current redaction snapshot to the step being added.
      return { ...task, auditLog, phase: "acting", steps: [...task.steps, { step: event.step, action: event.action, targetLabel: event.targetLabel, latencyMs: event.latencyMs, redactions: task.redactions }] };
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
  { label: "Mixtral 8x7B  ·  Groq", value: "groq:mixtral-8x7b-32768", provider: "groq", needsKey: true },
  // ── NVIDIA NIM ──────────────────────────────────────────────────
  { label: "Nemotron-3 120B  ·  NVIDIA", value: "nvidia:nvidia/nemotron-3-super-120b-a12b", provider: "nvidia", needsKey: true },
  { label: "Llama 3.2 11B  ·  NVIDIA", value: "nvidia:meta/llama-3.2-11b-vision-instruct", provider: "nvidia", needsKey: true },
  // ── Ollama (local, no key) ───────────────────────────────────────
  { label: "skrim-planner  ·  Ollama (local)", value: "ollama:skrim-planner", provider: "ollama", needsKey: false },
  { label: "Qwen3-VL 4B  ·  Ollama (local)", value: "ollama:qwen3-vl:4b-instruct", provider: "ollama", needsKey: false },
  { label: "Llama 3.2 3B  ·  Ollama (local)", value: "ollama:llama3.2:3b", provider: "ollama", needsKey: false },
];

const ICON_SIZE = 16;

function describeCounts(counts: RedactionCounts): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n && n > 0)
    .map(([category, n]) => `${n} ${CATEGORY_WORDS[category as PiiCategory][n === 1 ? 0 : 1]}`);
  return parts.join(", ");
}

/** Shows text with each PII token as a labelled pill. */
function Tokenised({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const category = match[1] as PiiCategory;
    const word = CATEGORY_WORDS[category]?.[0] ?? "private value";
    parts.push(<span className="token" key={index} title={`Your ${word}, kept on this device`}>{word} {match[2]}</span>);
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
  // TASK_06: show redaction count for this step if anything was hidden.
  const redactionSummary = step.redactions ? describeCounts(step.redactions) : undefined;
  return (
    <li className={`step step-${status}`}>
      <span className="step-icon" aria-hidden="true"><ActionIcon className="icon" size={ICON_SIZE} /></span>
      <div className="step-body">
        <div className="step-title"><Tokenised text={describeAction(step.action, step.targetLabel)} /></div>
        {reason && <div className="step-reason"><Tokenised text={reason} /></div>}
        {step.verified === false && <div className="step-note">{step.message ?? "Not confirmed."}</div>}
        {redactionSummary && <div className="step-redactions"><ShieldCheck className="icon" size={12} aria-hidden="true" />{redactionSummary} hidden</div>}
      </div>
      <span className="step-meta">
        {step.verified === undefined ? <span className="spinner" aria-label="Working" /> : step.verified ? <CircleCheck className="icon" size={ICON_SIZE} aria-label="Done" /> : <AlertTriangle className="icon" size={ICON_SIZE} aria-label="Not confirmed" />}
        <small>{(step.latencyMs / 1000).toFixed(1)} s</small>
      </span>
    </li>
  );
}

/** How the task ended, with what stayed on the device one click away rather than under every answer. */
function ResultCard({ finished }: { finished: Finished }) {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const kept = describeCounts(finished.tokens);
  return (
    <div className={`result result-${finished.outcome}`}>
      {finished.outcome === "completed" && <div className="result-title"><CircleCheck className="icon" size={ICON_SIZE} aria-hidden="true" /> Done</div>}
      {finished.outcome === "cancelled" && <div className="result-title"><Square className="icon" size={ICON_SIZE} aria-hidden="true" /> Stopped</div>}
      {finished.outcome === "failed" && <div className="result-title"><AlertTriangle className="icon" size={ICON_SIZE} aria-hidden="true" /> {ERROR_TITLES[finished.errorCode ?? "CONTENT_SCRIPT_ERROR"] ?? "Something went wrong"}</div>}
      {finished.summary && <p><Tokenised text={finished.summary} /></p>}
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
        <p className="privacy-detail">
          <ShieldCheck className="icon" size={ICON_SIZE} aria-hidden="true" />
          <span>{kept ? `Kept on this device: ${kept}. The server only saw placeholders.` : "No personal data found on these pages."}</span>
        </p>
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
        {task.phase !== "done" && (
          <div className="working"><span className="spinner" aria-hidden="true" /> {PHASE_WORDS[task.phase]}…</div>
        )}
        {finished && <ResultCard finished={finished} />}
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
    const planner = createServerPlanner(runtimeServerUrl);
    if (!goal || running) return;
    // TASK_05: deterministic injection guard before the loop starts.
    const injectionWarning = detectInjection(goal);
    if (injectionWarning) { setGoalError(injectionWarning); return; }
    setGoalError(undefined);
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
    // Build modelOverride string: "provider:model:apiKey" (empty = server default).
    const modelOverride = selectedModelValue
      ? (apiKey ? `${selectedModelValue}:${apiKey}` : selectedModelValue)
      : undefined;
    const taskPermissions: TaskPermissions = { ...permissions, ...(modelOverride ? { modelOverride } : {}) };
    try {
      await runAgentTask({
        goal,
        planner,
        link: tabLink(tab.id),
        signal: controller.signal,
        onEvent: (e) => { update(e); feed.onEvent(e); },
        findNames,
        readPixels: tabPixelReader(tab.id),
        permissions: taskPermissions,
      });
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
          {/* TASK_02 + TASK_03: Settings panel toggle */}
          <button className="icon-button" type="button" onClick={() => setShowSettings((s) => !s)} title="Rules &amp; settings" aria-label="Rules and settings" aria-expanded={showSettings}><Settings className="icon" size={ICON_SIZE} /></button>
          <button className="icon-button" type="button" onClick={() => setItems([])} disabled={running || items.length === 0} title="Clear the chat" aria-label="Clear the chat"><Eraser className="icon" size={ICON_SIZE} /></button>
        </div>
      </header>

      {/* TASK_02 + TASK_03: Collapsible settings panel */}
      {showSettings && (
        <div className="settings-panel" role="region" aria-label="Rules and settings">
          <div className="settings-section">
            <div className="settings-label">Allowed actions for this session</div>
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
          <div className="settings-section">
            <label className="settings-label" htmlFor="model-select">Model</label>
            <select
              id="model-select"
              className="settings-model-select"
              value={selectedModelValue}
              onChange={(e) => { setSelectedModelValue(e.target.value); setApiKey(""); }}
              disabled={running}
            >
              {KNOWN_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            {KNOWN_MODELS.find((m) => m.value === selectedModelValue)?.needsKey && (
              <input
                className="settings-url-input"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={running}
                placeholder="Paste API key…"
                autoComplete="off"
                spellCheck={false}
              />
            )}
            <p className="settings-hint">Key stays in memory — cleared when you close this panel.</p>
          </div>
          <div className="settings-section">
            <label className="settings-label" htmlFor="custom-instructions">Custom instructions</label>
            <textarea
              id="custom-instructions"
              className="settings-instructions-input"
              value={permissions.customInstructions ?? ""}
              onChange={(e) => setPermissions((prev) => ({ ...prev, customInstructions: e.target.value }))}
              disabled={running}
              placeholder="e.g. Never click on sponsored links. Summarize before acting."
              spellCheck={false}
            />
            <p className="settings-hint">These instructions will be sent to the planner with your goal.</p>
          </div>
          <div className="settings-section">
            <label className="settings-label" htmlFor="server-url-input">Planning server URL</label>
            <div className="settings-url-row">
              <input
                id="server-url-input"
                className="settings-url-input"
                type="url"
                value={runtimeServerUrl}
                onChange={(e) => setRuntimeServerUrl(e.target.value.trim())}
                disabled={running}
                placeholder={SERVER_URL}
                spellCheck={false}
                autoComplete="off"
              />
              <button className="settings-url-check" type="button" onClick={() => void checkServer()} disabled={running} title="Test connection">Test</button>
            </div>
            <p className="settings-hint">Resets when you close this panel. Point to your own server for BYOK.</p>
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
        {items.map((item) => (
          <div key={item.id} className="task-wrapper">
            <TaskView task={item} />
            {/* TASK_07: download audit log once the task is done */}
            {item.phase === "done" && (
              <button className="audit-download" type="button" onClick={() => downloadAuditLog(item)} title="Download full audit log for this task">
                <Download className="icon" size={12} aria-hidden="true" /> Audit log
              </button>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </main>

      <footer className="composer">
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
