import { useState, useEffect, useCallback, useRef } from "react";
import {
  DashboardMessageSchema,
  type DashboardMessage,
  type DashboardAgentEvent,
  type PlanRequest,
  type PlanResponse,
  type Resources,
  findPiiTokens,
} from "@skrim/schema";

// ─── State ──────────────────────────────────────────────────────────────────

interface TaskState {
  taskId: string;
  redactedGoal: string;
  events: DashboardAgentEvent[];
  latestRequest?: PlanRequest;
  latestResponse?: PlanResponse;
  resources?: Resources;
  finished: boolean;
}

// ─── Token highlighting ──────────────────────────────────────────────────────

function TokenText({ text }: { text: string }) {
  const tokens = findPiiTokens(text);
  if (tokens.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const idx = text.indexOf(token, cursor);
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <span key={idx} className="token-pill">
        {token}
      </span>,
    );
    cursor = idx + token.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// ─── Wire view — pretty-print the PlanRequest ────────────────────────────────

function WireView({ request }: { request: PlanRequest }) {
  const lines = JSON.stringify(request, null, 2).split("\n");
  return (
    <pre className="wire-pre">
      {lines.map((line, i) => {
        const tokenMatch = /<PII:[A-Z_]+:\d+>/g.exec(line);
        if (!tokenMatch) return <div key={i}>{line}</div>;
        // Highlight token strings inline
        const parts: React.ReactNode[] = [];
        let rest = line;
        let offset = 0;
        const matches = [...line.matchAll(/<PII:[A-Z_]+:\d+>/g)];
        let last = 0;
        for (const m of matches) {
          parts.push(rest.slice(last - offset, (m.index ?? 0) - offset));
          parts.push(
            <span key={m.index} className="token-pill">
              {m[0]}
            </span>,
          );
          last = (m.index ?? 0) + m[0].length;
        }
        parts.push(rest.slice(last - offset));
        return <div key={i}>{parts}</div>;
      })}
    </pre>
  );
}

// ─── Elements panel ──────────────────────────────────────────────────────────

function ElementsPanel({ request }: { request: PlanRequest }) {
  const elements = request.graph.elements;
  return (
    <div className="elements-panel">
      <div className="panel-label">What the server sees ({elements.length} elements)</div>
      <table className="el-table">
        <thead>
          <tr>
            <th>id</th>
            <th>role</th>
            <th>label / value</th>
          </tr>
        </thead>
        <tbody>
          {elements.slice(0, 60).map((el) => (
            <tr key={el.id}>
              <td className="el-id">{el.id}</td>
              <td className="el-role">{el.role}</td>
              <td className="el-label">
                <TokenText text={el.label ?? el.value ?? ""} />
              </td>
            </tr>
          ))}
          {elements.length > 60 && (
            <tr>
              <td colSpan={3} className="el-more">
                …and {elements.length - 60} more
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Step feed ───────────────────────────────────────────────────────────────

function StepBadge({ event }: { event: DashboardAgentEvent }) {
  switch (event.type) {
    case "started":
      return (
        <div className="step-card step-started">
          <span className="step-type">▶ started</span>
          <span className="step-detail">
            <TokenText text={event.redactedGoal} />
          </span>
        </div>
      );
    case "observed":
      return (
        <div className="step-card step-observed">
          <span className="step-type">👁 step {event.step} · observed</span>
          <span className="step-detail">
            {event.elements} elements ·{" "}
            {Object.entries(event.redactions)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${n} ${k}`)
              .join(", ") || "no PII"}
          </span>
        </div>
      );
    case "planned":
      return (
        <div className="step-card step-planned">
          <span className="step-type">🧠 step {event.step} · {event.actionType}</span>
          <span className="step-detail">
            {event.targetLabel && <TokenText text={event.targetLabel} />}
            <span className="step-latency">{event.latencyMs}ms</span>
          </span>
        </div>
      );
    case "acted":
      return (
        <div className={`step-card ${event.verified ? "step-ok" : "step-warn"}`}>
          <span className="step-type">{event.verified ? "✓" : "!"} step {event.step} · acted</span>
          {(event.message ?? event.note) && <span className="step-detail"><TokenText text={event.message ?? event.note ?? ""} /></span>}
        </div>
      );
    case "warning":
      return (
        <div className="step-card step-warning">
          <span className="step-type">⚠ warning</span>
          <span className="step-detail">{event.message}</span>
        </div>
      );
    case "finished":
      return (
        <div className={`step-card step-finished-${event.outcome}`}>
          <span className="step-type">
            {event.outcome === "completed" ? "✓ done" : event.outcome === "cancelled" ? "◼ stopped" : "✗ failed"}
          </span>
          <span className="step-detail">
            {event.steps} steps
            {event.summary && <> · <TokenText text={event.summary} /></>}
          </span>
        </div>
      );
    case "heartbeat":
      return null;
  }
}

// ─── Resource panel ──────────────────────────────────────────────────────────

function fmt(n: number | undefined, unit: string, decimals = 0): string {
  if (n === undefined) return "—";
  return `${n.toFixed(decimals)}${unit}`;
}

type StageTimings = Extract<DashboardAgentEvent, { type: "observed" }>["stageTimingsMs"];

function ResourcePanel({
  resources,
  model,
  provider,
  connected,
  stages,
}: {
  resources?: Resources;
  model: string;
  provider: string;
  connected: boolean;
  /** The latest page view's timings. */
  stages?: StageTimings;
}) {
  const footprint = resources?.modelFiles.reduce((sum, file) => sum + file.sizeBytes, 0) ?? 0;
  return (
    <aside className="resource-panel">
      <div className="res-header">
        <span className={`status-dot ${connected ? "dot-live" : "dot-off"}`} />
        <span className="res-title">Resource Panel</span>
        {!connected && <span className="disconnected-badge">disconnected</span>}
      </div>

      <div className="res-section">
        <div className="res-row">
          <span className="res-key">Model</span>
          <span className="res-val">{model || "—"}</span>
        </div>
        <div className="res-row">
          <span className="res-key">Provider</span>
          <span className="res-val">{provider || "—"}</span>
        </div>
      </div>

      <div className="res-section">
        <div className="res-label">Latency</div>
        <div className="res-row">
          <span className="res-key">Round trip</span>
          <span className="res-val">{fmt(resources?.roundTripMs, "ms")}</span>
        </div>
        <div className="res-row">
          <span className="res-key">Model only</span>
          <span className="res-val">{fmt(resources?.modelLatencyMs, "ms")}</span>
        </div>
        <div className="res-label res-label-sub">On this device, last page view</div>
        <div className="res-row">
          <span className="res-key">read page</span><span className="res-val">{fmt(stages?.observe, "ms")}</span>
        </div>
        <div className="res-row">
          <span className="res-key">read pixels (OCR)</span><span className="res-val">{fmt(stages?.pixels, "ms")}</span>
        </div>
        <div className="res-row">
          <span className="res-key">find names</span><span className="res-val">{fmt(stages?.names, "ms")}</span>
        </div>
        <div className="res-row">
          <span className="res-key">redact</span><span className="res-val">{fmt(stages?.redact, "ms")}</span>
        </div>
      </div>

      <div className="res-section">
        <div className="res-label">Memory</div>
        <div className="res-row">
          <span className="res-key">JS heap</span>
          <span className="res-val">
            {resources?.jsHeapBytes
              ? `${(resources.jsHeapBytes / 1e6).toFixed(1)} MB`
              : "—"}
          </span>
        </div>
      </div>

      <div className="res-section">
        <div className="res-label">Tokens</div>
        <div className="res-row">
          <span className="res-key">Steps</span>
          <span className="res-val">{resources?.steps ?? 0}</span>
        </div>
        <div className="res-row">
          <span className="res-key">Prompt</span>
          <span className="res-val">{resources?.promptTokens ?? 0}</span>
        </div>
        <div className="res-row">
          <span className="res-key">Completion</span>
          <span className="res-val">{resources?.completionTokens ?? 0}</span>
        </div>
      </div>

      <div className="res-section">
        <div className="res-label">Models on device{footprint > 0 && ` · ${(footprint / 1024 / 1024).toFixed(1)} MB`}</div>
        {resources?.modelFiles.length ? (
          resources.modelFiles.map((f) => (
            <div className="res-row" key={f.name}>
              <span className="res-key res-key-sm">{f.name}</span>
              <span className="res-val">
                {(f.sizeBytes / 1024 / 1024).toFixed(1)} MB · {f.backend === "unknown" ? "not loaded" : f.backend}
              </span>
            </div>
          ))
        ) : (
          <div className="res-row res-dim">
            <span className="res-key">no model list: run pnpm models:fetch</span>
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

/**
 * The side panel sends a heartbeat every 2 s while it is open. Three missed
 * means it closed; a slow planner step (15 s on a rate-limited Groq) is not.
 */
const DISCONNECTED_AFTER_MS = 6_000;

export default function App() {
  const [task, setTask] = useState<TaskState | null>(null);
  const [lastGood, setLastGood] = useState<TaskState | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  /** The latest resources, from heartbeats too: shown before any task starts. */
  const [resources, setResources] = useState<Resources | undefined>(undefined);
  /** The model that planned the latest step: the fallback's when the main one was busy. */
  const [lastModel, setLastModel] = useState("");
  const feedEndRef = useRef<HTMLDivElement>(null);
  const silence = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleMessage = useCallback((event: MessageEvent) => {
    // Only this page's own messages: the extension's content script relays
    // them here with window.postMessage.
    if (event.source !== window || event.origin !== window.location.origin) return;
    const raw = event.data;
    if (!raw || typeof raw !== "object" || raw.__skrimDashboard !== true) return;

    const parsed = DashboardMessageSchema.safeParse(raw);
    if (!parsed.success) {
      setParseError(`Malformed message (${parsed.error.issues.length} issues)`);
      return;
    }
    setParseError(null);

    const msg: DashboardMessage = parsed.data;
    setConnected(true);
    clearTimeout(silence.current);
    silence.current = setTimeout(() => setConnected(false), DISCONNECTED_AFTER_MS);
    if (msg.resources) setResources(msg.resources);
    if (msg.response?.model) setLastModel(msg.response.model);
    if (msg.event.type === "heartbeat") return;

    setTask((prev) => {
      const isNewTask =
        !prev || (msg.event.type === "started" && msg.event.taskId !== prev.taskId);

      const base: TaskState = isNewTask
        ? {
            taskId: msg.event.type === "started" ? msg.event.taskId : prev?.taskId ?? "",
            redactedGoal:
              msg.event.type === "started" ? msg.event.redactedGoal : prev?.redactedGoal ?? "",
            events: [],
            finished: false,
          }
        : { ...prev! };

      const next: TaskState = {
        ...base,
        events: [...base.events, msg.event],
        latestRequest: msg.request ?? base.latestRequest,
        latestResponse: msg.response ?? base.latestResponse,
        resources: msg.resources ?? base.resources,
        finished: msg.event.type === "finished",
      };
      setLastGood(next);
      return next;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      clearTimeout(silence.current);
    };
  }, [handleMessage]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [task?.events.length]);

  const display = task ?? lastGood;
  const planner = resources?.planner;
  // A step planned by the fallback says so: its model is the fallback's.
  const byFallback = planner?.fallback !== undefined && lastModel === planner.fallback.model;
  const model = lastModel || planner?.model || "";
  const provider = byFallback ? `${planner!.fallback!.provider} (fallback)` : planner?.provider ?? "";
  const lastObserved = [...(display?.events ?? [])].reverse().find((event) => event.type === "observed");
  const stages = lastObserved?.type === "observed" ? lastObserved.stageTimingsMs : undefined;

  return (
    <div className="dashboard">
      {/* ── Header ── */}
      <header className="dash-header">
        <div className="dash-brand">
          <span className="dash-mark">S</span>
          <strong>Skrim</strong>
          <span className="dash-sub">Privacy Dashboard</span>
        </div>
        {display?.redactedGoal && (
          <div className="dash-goal">
            <TokenText text={display.redactedGoal} />
          </div>
        )}
        {parseError && <div className="parse-warn">⚠ {parseError}</div>}
      </header>

      <div className="dash-body">
        {/* ── Left: wire view + elements ── */}
        <main className="dash-main">
          {!display ? (
            <div className="waiting">
              <div className="waiting-icon">⏳</div>
              <h1>Waiting for a task…</h1>
              <p>Start a task in the Skrim side panel.<br />Every step will appear here live.</p>
            </div>
          ) : (
            <>
              {/* Step feed */}
              <section className="feed-section">
                <div className="section-label">Live feed</div>
                <div className="feed">
                  {display.events.map((ev, i) => (
                    <StepBadge key={i} event={ev} />
                  ))}
                  <div ref={feedEndRef} />
                </div>
              </section>

              {/* Wire view */}
              {display.latestRequest && (
                <section className="wire-section">
                  <div className="section-label">
                    What the server received
                    <span className="section-sub"> — redacted, tokens only</span>
                  </div>
                  <WireView request={display.latestRequest} />
                </section>
              )}

              {/* Elements panel */}
              {display.latestRequest && (
                <ElementsPanel request={display.latestRequest} />
              )}
            </>
          )}
        </main>

        {/* ── Right: resource panel ── */}
        <ResourcePanel
          resources={resources ?? display?.resources}
          model={model}
          provider={provider}
          connected={connected}
          stages={stages}
        />
      </div>
    </div>
  );
}
