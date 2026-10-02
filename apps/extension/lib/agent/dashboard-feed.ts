/**
 * Dashboard feed — the bridge from the side panel to the dashboard tab.
 *
 * WHAT IT DOES
 * - Wraps the action planner: sees each PlanRequest exactly as sent and the
 *   PlanResponse that came back. Neither is modified; the wrapper is read-only.
 * - Receives AgentEvents via the onEvent hook in App.tsx (one line there).
 * - Posts DashboardMessages to the dashboard tab through the content script,
 *   which relays them with window.postMessage.
 *
 * WHAT IT DOES NOT DO
 * - It never touches the vault, raw page text, or any value that is not already
 *   redacted, and every message is scanned for raw PII before it leaves.
 * - It does not route anything through the server. The server is stateless.
 * - It does not duplicate the planner: it wraps it.
 *
 * ROUTING
 * The side panel cannot postMessage directly to an arbitrary tab. Instead it
 * sends a typed message to the content script running on the dashboard tab.
 * The content script forwards it with window.postMessage, which the dashboard's
 * React app listens to.
 */

import {
  DashboardMessageSchema,
  scanForRawPii,
  type DashboardMessage,
  type Resources,
} from "@skrim/schema";
import type { PlanRequest, PlanResponse } from "@skrim/schema";
import { log } from "@skrim/shared";
import type { ActionPlanner } from "../integration.ts";
import type { AgentEvent } from "./loop.ts";

/** The URL the dashboard runs on. Default: local Vite dev server. (No env in Node tests.) */
export const DASHBOARD_URL: string =
  (import.meta.env?.WXT_DASHBOARD_URL as string | undefined) ?? "http://localhost:5173";

/** Marker so the content script only forwards messages from this module. */
export const DASHBOARD_MSG_TYPE = "__skrimToDashboard" as const;

// ─── Resource snapshot ──────────────────────────────────────────────────────

/** Reads the JS heap from Chrome's non-standard performance.memory API. */
function heapSnapshot(): Pick<Resources, "jsHeapBytes" | "jsHeapLimitBytes"> {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!mem) return {};
  return { jsHeapBytes: mem.usedJSHeapSize, jsHeapLimitBytes: mem.jsHeapSizeLimit };
}

// ─── The feed ───────────────────────────────────────────────────────────────

export interface DashboardFeedOptions {
  /** The tab id the dashboard is open on, or null when it is not open. */
  getDashboardTabId: () => number | null;
  /** What the side panel knows about the models on the device and the planner. */
  getContext?: () => Pick<Resources, "modelFiles" | "planner">;
  /** Sends a message to a tab; browser.tabs.sendMessage unless a test says otherwise. */
  sendToTab?: (tabId: number, message: unknown) => Promise<unknown>;
}

interface StepStats {
  steps: number;
  promptTokens: number;
  completionTokens: number;
  roundTripMs?: number;
  modelLatencyMs?: number;
}

/**
 * The live feed state, for the lifetime of the side panel. Everything is in
 * memory and dies with the panel.
 */
export class DashboardFeed {
  private readonly options: DashboardFeedOptions;
  private stats: StepStats = { steps: 0, promptTokens: 0, completionTokens: 0 };
  private lastRequest: PlanRequest | undefined;
  private lastResponse: PlanResponse | undefined;

  constructor(options: DashboardFeedOptions) {
    this.options = options;
  }

  /** Called for every AgentEvent the loop emits. */
  onEvent(event: AgentEvent): void {
    // The loop's events are already redacted (that is the point of AgentEvent).
    const dashboardEvent = toDashboardEvent(event);
    if (!dashboardEvent) return;

    if (event.type === "started") this.stats = { steps: 0, promptTokens: 0, completionTokens: 0 };
    if (event.type === "planned") {
      this.stats.steps += 1;
      this.stats.modelLatencyMs = event.latencyMs;
    }

    this.send({
      __skrimDashboard: true,
      sentAt: new Date().toISOString(),
      event: dashboardEvent,
      ...(this.lastRequest && event.type === "planned"
        ? { request: this.lastRequest, response: this.lastResponse }
        : {}),
      resources: this.resources(),
    });
  }

  /** Tells the dashboard the side panel is still open, while nothing else happens. */
  heartbeat(): void {
    this.send({ __skrimDashboard: true, sentAt: new Date().toISOString(), event: { type: "heartbeat" }, resources: this.resources() });
  }

  /** Called by the planner wrapper to register the request/response pair. */
  onPlan(request: PlanRequest, response: PlanResponse, roundTripMs: number): void {
    this.lastRequest = request;
    this.lastResponse = response;
    this.stats.roundTripMs = roundTripMs;
    this.stats.promptTokens += response.usage?.promptTokens ?? 0;
    this.stats.completionTokens += response.usage?.completionTokens ?? 0;
  }

  private resources(): Resources {
    const context = this.options.getContext?.();
    return {
      modelFiles: context?.modelFiles ?? [],
      ...(context?.planner ? { planner: context.planner } : {}),
      ...heapSnapshot(),
      steps: this.stats.steps,
      promptTokens: this.stats.promptTokens,
      completionTokens: this.stats.completionTokens,
      ...(this.stats.roundTripMs !== undefined ? { roundTripMs: this.stats.roundTripMs } : {}),
      ...(this.stats.modelLatencyMs !== undefined ? { modelLatencyMs: this.stats.modelLatencyMs } : {}),
    };
  }

  private send(msg: DashboardMessage): void {
    const tabId = this.options.getDashboardTabId();
    if (tabId === null) return;

    // Validate before sending — the schema is the contract.
    const parsed = DashboardMessageSchema.safeParse(msg);
    if (!parsed.success) {
      log.warn("dashboard.invalidMessage", { issues: parsed.error.issues.length });
      return;
    }

    // The same tripwire as requests to the server, over the whole message:
    // the goal, the step notes and the summary travel too.
    const findings = scanForRawPii(JSON.stringify(parsed.data));
    if (findings.length > 0) {
      log.warn("dashboard.piiTripwire", { findings: findings.length });
      return;
    }

    // Send to content script on the dashboard tab; it relays via postMessage.
    const sendToTab = this.options.sendToTab ?? ((id: number, message: unknown) => browser.tabs.sendMessage(id, message));
    sendToTab(tabId, { type: DASHBOARD_MSG_TYPE, payload: parsed.data }).catch(() => {
      // Dashboard tab closed or content script not yet ready — silently skip.
    });
  }
}

// ─── Planner wrapper ────────────────────────────────────────────────────────

/**
 * Wraps an ActionPlanner so the feed sees the exact request and response.
 * Does NOT change the planner's behaviour — it is a read-only observer.
 */
export function withDashboardFeed(planner: ActionPlanner, feed: DashboardFeed): ActionPlanner {
  return async (request, signal) => {
    const start = Date.now();
    const response = await planner(request, signal);
    const roundTripMs = Date.now() - start;
    feed.onPlan(request, response, roundTripMs);
    return response;
  };
}

// ─── AgentEvent → DashboardAgentEvent translation ───────────────────────────

export function toDashboardEvent(event: AgentEvent): DashboardMessage["event"] | null {
  switch (event.type) {
    case "started":
      return { type: "started", taskId: event.taskId, redactedGoal: event.redactedGoal };
    case "observed":
      return {
        type: "observed",
        step: event.step,
        elements: event.elements,
        redactions: event.redactions as Record<string, number>,
        page: event.page,
        stageTimingsMs: {
          observe: Math.round(event.timings.observeMs),
          pixels: Math.round(event.timings.visionMs),
          names: Math.round(event.timings.namesMs),
          redact: Math.round(event.timings.redactMs),
        },
      };
    case "planned":
      return {
        type: "planned",
        step: event.step,
        actionType: event.action.type,
        targetLabel: event.targetLabel,
        model: event.model,
        latencyMs: event.latencyMs,
      };
    case "acted":
      return {
        type: "acted",
        step: event.step,
        verified: event.verified,
        ...(event.note ? { note: event.note } : {}),
        ...(event.message ? { message: event.message } : {}),
      };
    case "warning":
      return { type: "warning", message: event.message };
    case "finished":
      return {
        type: "finished",
        outcome: event.outcome,
        steps: event.steps,
        tokens: event.tokens as Record<string, number>,
        summary: event.summary,
        errorCode: event.errorCode,
        message: event.message,
      };
    default:
      return null;
  }
}
