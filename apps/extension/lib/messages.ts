import { z } from "zod";
import { ActionSchema } from "@skrim/schema";
import { ErrorCodeSchema } from "./errors.ts";
import { TaskStatusSchema } from "./task-state.ts";

/**
 * Intra-extension message contract.
 *
 * These are NOT in @skrim/schema on purpose: that package is the
 * client ↔ server wire format, shared with the server and eval harness.
 * Messages between popup, background, and content are legitimately local
 * to the extension and would pollute the shared contract.
 *
 * Every message crossing a browser.runtime.sendMessage or
 * browser.tabs.sendMessage boundary is validated against these schemas
 * at both ends. This is defence in depth: a garbled message is a parse
 * failure, not a silent wrong-click.
 */

// ─── Popup → Background ────────────────────────────────────────────────────

export const TaskStartSchema = z.object({
  type: z.literal("task.start"),
  goal: z.string().min(1),
});
export type TaskStartMessage = z.infer<typeof TaskStartSchema>;

export const TaskCancelSchema = z.object({
  type: z.literal("task.cancel"),
});
export type TaskCancelMessage = z.infer<typeof TaskCancelSchema>;

// ─── Background → Content ──────────────────────────────────────────────────

export const PageObserveSchema = z.object({
  type: z.literal("page.observe"),
  taskId: z.string(),
});
export type PageObserveMessage = z.infer<typeof PageObserveSchema>;

export const ActionExecuteSchema = z.object({
  type: z.literal("action.execute"),
  action: ActionSchema,
  actionId: z.string(),
  taskId: z.string(),
});
export type ActionExecuteMessage = z.infer<typeof ActionExecuteSchema>;

// ─── Content → Background ──────────────────────────────────────────────────

export const PageObservationSchema = z.object({
  type: z.literal("page.observation"),
  taskId: z.string(),
  observationVersion: z.number().int().nonnegative(),
  elementCount: z.number().int().nonnegative(),
  hasVisualCapture: z.boolean(),
});
export type PageObservationMessage = z.infer<typeof PageObservationSchema>;

export const ActionResultSchema = z.object({
  type: z.literal("action.result"),
  ok: z.boolean(),
  actionId: z.string(),
  changed: z.boolean(),
  errorCode: ErrorCodeSchema.optional(),
  observationVersion: z.number().int().nonnegative(),
});
export type ActionResultMessage = z.infer<typeof ActionResultSchema>;

// ─── Background → Popup ────────────────────────────────────────────────────

export const TaskStatusMessageSchema = z.object({
  type: z.literal("task.status"),
  taskId: z.string().optional(),
  status: TaskStatusSchema,
  stepCount: z.number().int().nonnegative().optional(),
  maxSteps: z.number().int().positive().optional(),
  errorCode: ErrorCodeSchema.optional(),
});
export type TaskStatusMessage = z.infer<typeof TaskStatusMessageSchema>;

// ─── Union ─────────────────────────────────────────────────────────────────

export const MessageSchema = z.discriminatedUnion("type", [
  TaskStartSchema,
  TaskCancelSchema,
  PageObserveSchema,
  ActionExecuteSchema,
  PageObservationSchema,
  ActionResultSchema,
  TaskStatusMessageSchema,
]);
export type Message = z.infer<typeof MessageSchema>;

/**
 * Validate an incoming message. Returns null for anything that does not match
 * the contract — never throws, because the sender might be a different
 * extension, a stale content script, or a browser internal.
 */
export function parseMessage(data: unknown): Message | null {
  const result = MessageSchema.safeParse(data);
  return result.success ? result.data : null;
}

