import { z } from "zod";
import { ElementIdSchema } from "./element.js";

/**
 * The action space. Fixed, site-agnostic, eight verbs (brief section 6).
 *
 * THIS LIST IS CLOSED. Skrim has to work on websites we have never seen
 * (brief §4.6), so a verb that only makes sense on one site is a trap. If a task
 * seems to need a ninth verb, it almost always decomposes into these eight.
 *
 * The server returns exactly ONE action per cycle. It does not get to plan a
 * sequence, because the page changes under us and a stale plan clicks the wrong
 * thing. Observe, plan, act, verify - then plan again.
 */

const withReason = {
  /**
   * One short sentence on why this action was chosen. Shown in the dashboard
   * so a judge can follow the agent's reasoning live. Never contains PII: the
   * server has never seen any, so it cannot leak what it does not have.
   */
  reason: z.string().max(200).optional(),
};

export const ClickActionSchema = z.object({
  type: z.literal("click"),
  target: ElementIdSchema,
  ...withReason,
});

export const TypeActionSchema = z.object({
  type: z.literal("type"),
  target: ElementIdSchema,
  /**
   * Literal text, OR a PII token like `<PII:EMAIL:1>` which the client resolves
   * against the vault before typing. This is the whole referential-redaction
   * mechanism in one field.
   */
  value: z.string(),
  /** Press Enter afterwards. */
  submit: z.boolean().optional(),
  ...withReason,
});

export const ScrollActionSchema = z.object({
  type: z.literal("scroll"),
  direction: z.enum(["up", "down", "left", "right"]),
  /** Pixels. Defaults to roughly one viewport when omitted. */
  amount: z.number().optional(),
  /** Scroll within this element rather than the page. */
  target: ElementIdSchema.optional(),
  ...withReason,
});

export const SelectActionSchema = z.object({
  type: z.literal("select"),
  target: ElementIdSchema,
  /** The option's visible label, not its index - indices are not stable. */
  value: z.string(),
  ...withReason,
});

export const NavigateActionSchema = z.object({
  type: z.literal("navigate"),
  /**
   * Only same-origin paths, or "back". The server must NOT be able to send the
   * browser to an arbitrary host - that would turn a redaction bug into an
   * exfiltration channel. The client enforces this; see isNavigationAllowed().
   */
  to: z.string(),
  ...withReason,
});

export const ExtractActionSchema = z.object({
  type: z.literal("extract"),
  target: ElementIdSchema,
  /** Key to store the extracted value under, for use in later steps. */
  as: z.string(),
  ...withReason,
});

export const WaitActionSchema = z.object({
  type: z.literal("wait"),
  /** Capped client-side. A model that asks for 60s has lost the thread. */
  ms: z.number().int().min(0).max(10_000),
  ...withReason,
});

export const DoneActionSchema = z.object({
  type: z.literal("done"),
  /** What was accomplished, shown to the user. */
  summary: z.string(),
  success: z.boolean(),
  ...withReason,
});

export const ActionSchema = z.discriminatedUnion("type", [
  ClickActionSchema,
  TypeActionSchema,
  ScrollActionSchema,
  SelectActionSchema,
  NavigateActionSchema,
  ExtractActionSchema,
  WaitActionSchema,
  DoneActionSchema,
]);
export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action["type"];

export const ACTION_TYPES: readonly ActionType[] = [
  "click",
  "type",
  "scroll",
  "select",
  "navigate",
  "extract",
  "wait",
  "done",
] as const;

/**
 * Guard for the navigate verb. Same-origin or "back" only.
 *
 * The server is untrusted by design - it is a remote machine we do not control.
 * Letting it choose an arbitrary destination would mean a compromised or merely
 * confused model could navigate the user somewhere hostile, and any data in the
 * URL would go with them. Enforce this at execution time, every time.
 */
export function isNavigationAllowed(to: string, currentOrigin: string): boolean {
  if (to === "back") return true;
  if (to.startsWith("/")) return true;
  try {
    return new URL(to).origin === currentOrigin;
  } catch {
    return false;
  }
}
