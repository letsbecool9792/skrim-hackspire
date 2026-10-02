import type { PlanRequest, PlanResponse, ScreenElement } from "@skrim/schema";

/**
 * Registration points between workstreams. See docs/ws1-workflow.md.
 *
 * - The screen-graph provider (WS2) is registered in the CONTENT SCRIPT.
 * - The action planner (WS4) is registered in the SIDE PANEL, where the agent
 *   loop runs. The default calls the server; tests and the eval harness can
 *   register their own.
 */

export interface ScreenGraphSnapshot {
  /** RAW page text. The side panel redacts it before use. */
  elements: ScreenElement[];
  registry: Map<string, Element>;
  hasVisualCapture: boolean;
  /** Element id -> field type and autocomplete hint, for PII detection. */
  fields?: Record<string, { inputType?: string; autocomplete?: string }>;
}

export type ScreenGraphProvider = () => ScreenGraphSnapshot | Promise<ScreenGraphSnapshot>;

/**
 * One planning step: a redacted request in, one action out. `request` has
 * already passed redaction; the planner must still call assertOutboundSafe()
 * right before it sends anything over the network.
 */
export type ActionPlanner = (request: PlanRequest, signal: AbortSignal) => Promise<PlanResponse>;

let screenGraphProvider: ScreenGraphProvider | null = null;
let actionPlanner: ActionPlanner | null = null;

export function registerScreenGraphProvider(provider: ScreenGraphProvider | null): void {
  screenGraphProvider = provider;
}

export function getScreenGraphProvider(): ScreenGraphProvider | null {
  return screenGraphProvider;
}

export function registerActionPlanner(planner: ActionPlanner | null): void {
  actionPlanner = planner;
}

export function getActionPlanner(): ActionPlanner | null {
  return actionPlanner;
}
