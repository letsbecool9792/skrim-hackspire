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
 *   redacted. The PlanRequest passed to it has already cleared assertOutboundSafe.
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
  type DashboardMessage,
  type DashboardAgentEvent,
  assertOutboundSafe,
  type Resources,
} from "@skrim/schema";
import type { PlanRequest, PlanResponse } from "@skrim/schema";
import { log } from "@skrim/shared";
import type { ActionPlanner } from "../integration.ts";
import type { AgentEvent } from "./loop.ts";

/** The URL the dashboard runs on. Default: local Vite dev server. */
export const DASHBOARD_URL: string =
  (import.meta.env.WXT_DASHBOARD_URL as string | undefined) ?? "http://localhost:5173";

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
}

interface StepStats {
  steps: number;
  promptTokens: number;
  completionTokens: number;
  roundTripMs?: number;
  modelLatencyMs?: number;
}

/**
 * The live feed state. One instance per task run; re-created on each new task.
 * Everything is in memory and dies with the side panel.
 */
export class DashboardFeed {
  private readonly getDashboardTabId: () => number | null;
  private stats: StepStats = { steps: 0, promptTokens: 0, completionTokens: 0 };
  private lastRequest: PlanRequest | undefined;
  private lastResponse: PlanResponse | undefined;

  constructor(options: DashboardFeedOptions) {
    this.getDashboardTabId = options.getDashboardTabId;
  }

  /** Called by main.tsx for every AgentEvent the loop emits. */
  onEvent(event: AgentEvent): void {
    // Translate the loop's AgentEvent into a DashboardAgentEvent.
    // The loop's events are already redacted (that is the point of AgentEvent).
    const dashboardEvent = toDashboardEvent(event);
    if (!dashboardEvent) return;

    if (event.type === "planned") {
      this.stats.steps += 1;
      this.stats.modelLatencyMs = event.latencyMs;
    }

    const msg: DashboardMessage = {
      __skrimDashboard: true,
      sentAt: new Date().toISOString(),
      event: dashboardEvent,
      ...(this.lastRequest && event.type === "planned"
        ? { request: this.lastRequest, response: this.lastResponse }
        : {}),
      resources: {
        modelFiles: [], // populated by the model-file scan in App.tsx via setResources
        ...heapSnapshot(),
        steps: this.stats.steps,
        promptTokens: this.stats.promptTokens,
        completionTokens: this.stats.completionTokens,
        ...(this.stats.roundTripMs !== undefined ? { roundTripMs: this.stats.roundTripMs } : {}),
        ...(this.stats.modelLatencyMs !== undefined ? { modelLatencyMs: this.stats.modelLatencyMs } : {}),
      },
    };

    this.send(msg);
  }

  /** Called by the planner wrapper to register the request/response pair. */
  onPlan(request: PlanRequest, response: PlanResponse, roundTripMs: number): void {
    this.lastRequest = request;
    this.lastResponse = response;
    this.stats.roundTripMs = roundTripMs;
    this.stats.promptTokens += response.usage?.promptTokens ?? 0;
    this.stats.completionTokens += response.usage?.completionTokens ?? 0;
  }

  private send(msg: DashboardMessage): void {
    const tabId = this.getDashboardTabId();
    if (tabId === null) return;

    // Validate before sending — the schema is the contract.
    const parsed = DashboardMessageSchema.safeParse(msg);
    if (!parsed.success) {
      log.warn("dashboard.invalidMessage", { issues: parsed.error.issues.length });
      return;
    }

    // Additional tripwire: verify no raw PII snuck into the request/response.
    if (parsed.data.request) {
      try {
        assertOutboundSafe(parsed.data.request);
      } catch {
        log.warn("dashboard.piiTripwire", {});
        return;
      }
    }

    // Send to content script on the dashboard tab; it relays via postMessage.
    browser.tabs
      .sendMessage(tabId, { type: DASHBOARD_MSG_TYPE, payload: parsed.data })
      .catch(() => {
        // Dashboard tab closed or content script not yet ready — silently skip.
      });
  }
}

// ─── Planner wrapper ────────────────────────────────────────────────────────

/**
 * Wraps an ActionPlanner so the feed sees the exact request and response.
 * Does NOT change the planner's behaviour — it is a read-only observer.
 * The instruction says: do not change server-planner.ts or the loop.
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

function toDashboardEvent(event: AgentEvent): DashboardMessage["event"] | null {
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
      return { type: "acted", step: event.step, verified: event.verified, note: event.note };
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
