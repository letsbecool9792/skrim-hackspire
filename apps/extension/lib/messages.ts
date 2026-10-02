import { z } from "zod";
import { ActionSchema, ScreenElementSchema } from "@skrim/schema";
import { ErrorCodeSchema } from "./errors.ts";

/**
 * Intra-extension message contract: side panel <-> content script.
 *
 * These are NOT in @skrim/schema on purpose: that package is the
 * client ↔ server wire format, shared with the server and eval harness.
 * Messages inside the extension are local to it and would pollute the
 * shared contract.
 *
 * Every message crossing a browser.tabs.sendMessage boundary is validated
 * against these schemas at both ends. This is defence in depth: a garbled
 * message is a parse failure, not a silent wrong-click.
 *
 * These messages never leave the device, and some carry raw page text: the
 * observation's elements are unredacted, and a type action carries the real
 * value to type. Nothing here may be logged.
 */

// ─── Side panel → Content ──────────────────────────────────────────────────

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
  /**
   * For type actions: the value with every PII token already swapped for the
   * real text from the task's vault. The action itself keeps the tokens.
   */
  typedValue: z.string().optional(),
});
export type ActionExecuteMessage = z.infer<typeof ActionExecuteSchema>;

// ─── Content → Side panel (as the reply to the messages above) ─────────────

export const FieldInfoSchema = z.object({
  inputType: z.string().optional(),
  autocomplete: z.string().optional(),
});

export const PageObservationSchema = z.object({
  type: z.literal("page.observation"),
  taskId: z.string(),
  observationVersion: z.number().int().nonnegative(),
  elementCount: z.number().int().nonnegative(),
  hasVisualCapture: z.boolean(),
  graphAvailable: z.boolean().default(false),
  /** RAW. Redacted by the side panel before use. */
  elements: z.array(ScreenElementSchema).optional(),
  /** Element id -> field type and autocomplete hint, for PII detection. */
  fields: z.record(z.string(), FieldInfoSchema).optional(),
  /** RAW location.href. Sanitised by the side panel before use. */
  url: z.string().optional(),
  /** RAW document.title. */
  title: z.string().optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  /** How many elements were left out, above and below the view. */
  beyondView: z.object({ above: z.number().int().nonnegative(), below: z.number().int().nonnegative() }).optional(),
});
export type PageObservationMessage = z.infer<typeof PageObservationSchema>;

export const ActionResultSchema = z.object({
  type: z.literal("action.result"),
  taskId: z.string().optional(),
  ok: z.boolean(),
  actionId: z.string(),
  changed: z.boolean(),
  completed: z.boolean().default(false),
  errorCode: ErrorCodeSchema.optional(),
  observationVersion: z.number().int().nonnegative(),
  /** RAW text read by an extract action. Redacted by the side panel. */
  extractedValue: z.string().optional(),
  /** RAW: the action's target as it is now, if it is still on the page. */
  targetAfter: ScreenElementSchema.pick({ label: true, value: true, state: true }).optional(),
});
export type ActionResultMessage = z.infer<typeof ActionResultSchema>;

// ─── Union ─────────────────────────────────────────────────────────────────

export const MessageSchema = z.discriminatedUnion("type", [
  PageObserveSchema,
  ActionExecuteSchema,
  PageObservationSchema,
  ActionResultSchema,
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
