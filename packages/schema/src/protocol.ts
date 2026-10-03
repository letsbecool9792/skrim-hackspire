import { z } from "zod";
import { ActionSchema } from "./action.js";
import { ScreenGraphSchema } from "./graph.js";

/**
 * The client <-> server contract. Both sides import these, so a mismatch is a
 * compile error rather than a runtime surprise at the demo.
 *
 * The server is STATELESS. It has no session, no user identity, and no memory
 * between requests - everything it needs arrives in the request. That is not an
 * accident of design, it is the privacy claim: there is nothing on the server
 * to correlate, because nothing persists there.
 */

/** One completed step, so the model can see what it already tried. */
export const StepRecordSchema = z.object({
  cycle: z.number().int().nonnegative(),
  action: ActionSchema,
  /** Did the expected state change actually happen? */
  verified: z.boolean(),
  /**
   * What happened, in a few words: why it failed, or what the target shows
   * now ("now it is expanded"). Tokens only, never raw PII.
   */
  note: z.string().max(200).optional(),
});
export type StepRecord = z.infer<typeof StepRecordSchema>;

export const PlanRequestSchema = z.object({
  /** The user's goal in their own words. Redacted like everything else. */
  goal: z.string(),
  graph: ScreenGraphSchema,
  /** Bounded history. Trimmed client-side - long histories blow the latency budget. */
  history: z.array(StepRecordSchema).max(20),
  /**
   * Values captured by earlier `extract` actions, keyed by their `as` name.
   * Tokenised if sensitive, same as everything else.
   */
  extracted: z.record(z.string(), z.string()).optional(),
  /** User-defined rules from the settings panel (e.g. "Never click sponsored links"). */
  customInstructions: z.string().max(1000).optional(),
  /**
   * Override the server's default model for this request. Format: "provider:model:apiKey".
   * The server ignores this if it does not recognise the provider.
   */
  modelOverride: z.string().max(500).optional(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const PlanResponseSchema = z.object({
  action: ActionSchema,
  /** Which model produced this, for the tradeoff-curve slide (brief 9.6). */
  model: z.string(),
  /** Server-side round trip in ms, excluding network. Feeds the resource panel. */
  latencyMs: z.number().nonnegative(),
  /** How many JSON repair attempts were needed. Nonzero means the prompt needs work. */
  repairs: z.number().int().nonnegative().default(0),
  /**
   * Tokens the provider counted for this step, repairs included, when it
   * reports them. Free tiers limit tokens a minute, so this sets how many
   * steps a minute a provider can take.
   */
  usage: z.object({ promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative() }).optional(),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  /** Stable code so the client can branch without string matching. */
  code: z.enum([
    "invalid_request",
    "provider_error",
    "provider_rate_limited",
    "unparseable_model_output",
    "internal",
  ]),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
