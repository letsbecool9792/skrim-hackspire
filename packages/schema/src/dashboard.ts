import { z } from "zod";
import { PlanRequestSchema } from "./protocol.js";
import { PlanResponseSchema } from "./protocol.js";

/**
 * The contract between the extension side panel and the dashboard tab.
 *
 * Everything here is already redacted: the PlanRequest goes through
 * assertOutboundSafe() before it travels, and the AgentEvents mirror what
 * the loop already sends to the chat (which shows what the server saw, not
 * what the user typed). The dashboard ONLY renders; it never re-detects or
 * re-redacts anything.
 *
 * packages/schema may import nothing but zod. This file adds the dashboard
 * contract without importing from any app.
 */

// ─── Agent events (mirror of AgentEvent in lib/agent/loop.ts) ──────────────
// These are duplicated here so @skrim/schema stays self-contained and the
// dashboard can validate them without importing the extension.

export const DashboardStartedEventSchema = z.object({
  type: z.literal("started"),
  taskId: z.string(),
  /** The user's goal, already redacted. */
  redactedGoal: z.string(),
});

export const DashboardObservedEventSchema = z.object({
  type: z.literal("observed"),
  step: z.number().int().nonnegative(),
  elements: z.number().int().nonnegative(),
  /** Counts by PII category — never values. */
  redactions: z.record(z.string(), z.number().int().nonnegative()),
  page: z.string(),
  /** Per-stage timings (ms). Populated by Suparno's loop fix; undefined until then. */
  stageTimingsMs: z
    .object({
      observe: z.number().nonnegative().optional(),
      pixels: z.number().nonnegative().optional(),
      names: z.number().nonnegative().optional(),
      redact: z.number().nonnegative().optional(),
    })
    .optional(),
});

export const DashboardPlannedEventSchema = z.object({
  type: z.literal("planned"),
  step: z.number().int().nonnegative(),
  /** Action type only — never the target value. */
  actionType: z.string(),
  /** The element's label, already redacted or absent. */
  targetLabel: z.string().optional(),
  model: z.string(),
  latencyMs: z.number().nonnegative(),
});

export const DashboardActedEventSchema = z.object({
  type: z.literal("acted"),
  step: z.number().int().nonnegative(),
  verified: z.boolean(),
  note: z.string().optional(),
});

export const DashboardWarningEventSchema = z.object({
  type: z.literal("warning"),
  message: z.string(),
});

export const DashboardFinishedEventSchema = z.object({
  type: z.literal("finished"),
  outcome: z.enum(["completed", "failed", "cancelled"]),
  steps: z.number().int().nonnegative(),
  /** Counts by PII category, not values. */
  tokens: z.record(z.string(), z.number().int().nonnegative()),
  summary: z.string().optional(),
  errorCode: z.string().optional(),
  message: z.string().optional(),
});

export const DashboardAgentEventSchema = z.discriminatedUnion("type", [
  DashboardStartedEventSchema,
  DashboardObservedEventSchema,
  DashboardPlannedEventSchema,
  DashboardActedEventSchema,
  DashboardWarningEventSchema,
  DashboardFinishedEventSchema,
]);
export type DashboardAgentEvent = z.infer<typeof DashboardAgentEventSchema>;

// ─── Resource numbers ───────────────────────────────────────────────────────

export const ModelFileSchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** Which runtime the model actually bound to. */
  backend: z.enum(["wasm", "webgpu", "unknown"]),
});
export type ModelFile = z.infer<typeof ModelFileSchema>;

export const ResourcesSchema = z.object({
  /** Model files in public/models and which backend each bound. */
  modelFiles: z.array(ModelFileSchema),
  /** JS heap usage in bytes, from performance.memory (Chrome only). */
  jsHeapBytes: z.number().int().nonnegative().optional(),
  jsHeapLimitBytes: z.number().int().nonnegative().optional(),
  /** Cumulative steps and total tokens across the task so far. */
  steps: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  /** End-to-end round trip from wrapper (network + server latency), ms. */
  roundTripMs: z.number().nonnegative().optional(),
  /** Server-only model latency, ms — from PlanResponse.latencyMs. */
  modelLatencyMs: z.number().nonnegative().optional(),
});
export type Resources = z.infer<typeof ResourcesSchema>;

// ─── The message ────────────────────────────────────────────────────────────

/**
 * One message the side panel posts to the dashboard tab.
 *
 * It always carries the latest event, and optionally a snapshot of the request
 * and response (set on every "planned" step so the wire view stays current).
 *
 * The dashboard is stateful: it accumulates events in memory. Each message is
 * a delta, not a full state dump.
 */
export const DashboardMessageSchema = z.object({
  /** Discriminator so the dashboard can ignore window.postMessage noise. */
  __skrimDashboard: z.literal(true),
  /** ISO timestamp, for ordering and freshness checks. */
  sentAt: z.string(),
  event: DashboardAgentEventSchema,
  /**
   * The full PlanRequest exactly as sent to the server (already redacted,
   * assertOutboundSafe passed). Present on every "planned" step.
   */
  request: PlanRequestSchema.optional(),
  /**
   * The server's reply. Present on every "planned" step.
   */
  response: PlanResponseSchema.optional(),
  resources: ResourcesSchema.optional(),
});
export type DashboardMessage = z.infer<typeof DashboardMessageSchema>;

export type DashboardStartedEvent = z.infer<typeof DashboardStartedEventSchema>;
export type DashboardObservedEvent = z.infer<typeof DashboardObservedEventSchema>;
export type DashboardPlannedEvent = z.infer<typeof DashboardPlannedEventSchema>;
export type DashboardActedEvent = z.infer<typeof DashboardActedEventSchema>;
export type DashboardFinishedEvent = z.infer<typeof DashboardFinishedEventSchema>;
