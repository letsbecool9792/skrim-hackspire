import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Action, PiiCategory } from "@skrim/schema";
import type { ErrorCode } from "@/lib/errors.ts";
import { getActionPlanner } from "@/lib/integration.ts";
import { runAgentTask, type AgentEvent } from "@/lib/agent/loop.ts";
import type { RedactionCounts } from "@/lib/agent/redact.ts";
import type { NameFinder } from "@/lib/pii/gliner.ts";
import { fetchServerInfo, type ServerInfo } from "@/lib/agent/server-planner.ts";
import { tabLink } from "@/lib/agent/tab-link.ts";
import { tabPixelReader } from "@/lib/vision/read-pixels.ts";
import { SERVER_URL } from "./config.ts";
import { feed } from "./feed-instance.ts";

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
}

function applyEvent(task: TaskItem, event: AgentEvent): TaskItem {
  switch (event.type) {
    case "started":
      return { ...task, redactedGoal: event.redactedGoal, phase: "reading" };
    case "observed":
      return { ...task, phase: "planning", redactions: event.redactions };
    case "planned":
      if (event.action.type === "done") return task;
      return { ...task, phase: "acting", steps: [...task.steps, { step: event.step, action: event.action, targetLabel: event.targetLabel, latencyMs: event.latencyMs }] };
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

const ACTION_ICONS: Record<Action["type"], string> = {
  click: "↖", type: "⌨", select: "☰", scroll: "↕", navigate: "→", extract: "⎘", wait: "◷", done: "✓",
};

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
  if (info === "checking") return <span className="chip">Connecting…</span>;
  if (!info) {
    return (
      <button className="chip chip-bad" type="button" onClick={onRetry} title={`No planning server at ${SERVER_URL}. Start it with: pnpm dev:server`}>
        <span className="dot" /> Server offline · retry
      </button>
    );
  }
  return (
    <span className="chip" title={`Planning server at ${SERVER_URL}`}>
      <span className="dot dot-ok" /> {info.model.split("/").pop()} · {info.provider}
    </span>
  );
}

function StepRow({ step }: { step: StepView }) {
  const status = step.verified === undefined ? "pending" : step.verified ? "ok" : "warn";
  const reason = "reason" in step.action ? step.action.reason : undefined;
  return (
    <li className={`step step-${status}`}>
      <span className="step-icon" aria-hidden="true">{ACTION_ICONS[step.action.type]}</span>
      <div className="step-body">
        <div className="step-title"><Tokenised text={describeAction(step.action, step.targetLabel)} /></div>
        {reason && <div className="step-reason"><Tokenised text={reason} /></div>}
        {step.verified === false && <div className="step-note">{step.message ?? "Not confirmed."}</div>}
      </div>
      <span className="step-meta">
        {step.verified === undefined ? <span className="spinner" aria-label="Working" /> : step.verified ? "✓" : "!"}
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
      {finished.outcome === "completed" && <strong>✓ Done</strong>}
      {finished.outcome === "cancelled" && <strong>Stopped</strong>}
      {finished.outcome === "failed" && <strong>{ERROR_TITLES[finished.errorCode ?? "CONTENT_SCRIPT_ERROR"] ?? "Something went wrong"}</strong>}
      {finished.summary && <p><Tokenised text={finished.summary} /></p>}
      {finished.message && <p>{finished.message}</p>}
      <div className="result-foot">
        <small title={finished.errorCode}>
          {finished.steps} step{finished.steps === 1 ? "" : "s"}
        </small>
        <button className="info-button" type="button" onClick={() => setShowPrivacy((shown) => !shown)} aria-expanded={showPrivacy} aria-label="What stayed on this device" title="What stayed on this device">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="8" cy="4.9" r="0.9" fill="currentColor" /></svg>
        </button>
      </div>
      {showPrivacy && (
        <p className="privacy-detail">
          {kept ? `Kept on this device: ${kept}. The server only saw placeholders.` : "No personal data found on these pages."}
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
  const controllerRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const checkServer = useCallback(async () => {
    setServer("checking");
    setServer(await fetchServerInfo(SERVER_URL));
  }, []);

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

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      update({ type: "finished", outcome: "failed", steps: 0, tokens: {}, errorCode: "CONTENT_SCRIPT_ERROR", message: "There is no tab to work on." });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    try {
      await runAgentTask({ goal, planner, link: tabLink(tab.id), signal: controller.signal, onEvent: (e) => { update(e); feed.onEvent(e); }, findNames, readPixels: tabPixelReader(tab.id) });
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
        <div className="brand"><span className="mark" aria-hidden="true">S</span><strong>Skrim</strong></div>
        <ServerChip info={server} onRetry={() => void checkServer()} />
        <div className="topbar-actions">
          <button className="icon-button" type="button" onClick={() => setItems([])} disabled={running || items.length === 0} title="Clear the chat" aria-label="Clear the chat">⌫</button>
        </div>
      </header>

      <main className="chat">
        {items.length === 0 && (
          <div className="empty">
            <h1>What should I do on this page?</h1>
            <p>Skrim reads the page on your device, swaps personal details for placeholders, and asks the planning server for one step at a time.</p>
            <div className="examples">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => { setDraft(example); inputRef.current?.focus(); }}>{example}</button>
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
          ? <button className="send stop" type="button" onClick={stop} aria-label="Stop" title="Stop (Esc)">■</button>
          : <button className="send" type="button" onClick={() => void start(draft)} disabled={!draft.trim()} aria-label="Send" title="Send (Enter)">↑</button>}
      </footer>
    </div>
  );
}
