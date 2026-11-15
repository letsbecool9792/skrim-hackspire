import type { PlanRequest, PlanResponse } from '@skrim/schema';
import { providerKey, type ProviderConfig } from '../config.js';
import { ProviderError } from '../providers/index.js';

type Plan = Omit<PlanResponse, 'latencyMs'>;
type PlanOne = (provider: ProviderConfig, request: PlanRequest) => Promise<Plan>;

/** How long to rest a provider that said to come back later without saying when. */
const DEFAULT_REST_MS = 60_000;
/** The longest pause worth sitting out when no other provider can plan: under Vercel's 60 s. */
const MAX_PAUSE_TO_SIT_OUT_MS = 45_000;

/**
 * Plans a step with the first provider in `chain` that can: the main one,
 * then FALLBACK_PROVIDER's, in order.
 *
 * - One that says to come back later is rested until then (`resting`, by
 *   provider and model: Groq limits each model apart), so later steps skip it instead of each costing a refused
 *   request. That is state about providers, not users.
 * - One that fails for its own reasons (a model it no longer serves, a 5xx)
 *   passes the step on too: a misconfigured fallback must not end a task the
 *   main provider could finish.
 * - When every provider failed and one only asked for a short pause, that
 *   pause is sat out after all.
 * - The model's own failure (no valid action) is not another provider's to
 *   fix, and is thrown.
 */
export async function planWithChain(chain: readonly ProviderConfig[], request: PlanRequest, planOne: PlanOne, resting: Map<string, number>, now = Date.now()): Promise<Plan> {
  const awake = chain.filter((provider) => (resting.get(providerKey(provider)) ?? 0) <= now);
  // All resting: try them all anyway, the main one first.
  const order = awake.length > 0 ? awake : chain;
  let shortPause: ProviderConfig | undefined;
  let firstError: unknown;
  // When all fail, "come back later" says more than one broken fallback's error.
  let rateLimit: unknown;
  for (const [index, provider] of order.entries()) {
    try {
      return await planOne(provider, request);
    } catch (error) {
      firstError ??= error;
      if (!(error instanceof ProviderError)) throw error;
      const limited = error.kind === 'rate_limited';
      if (limited) {
        rateLimit ??= error;
        resting.set(providerKey(provider), Date.now() + (error.retryAfterMs ?? DEFAULT_REST_MS));
        if (!shortPause && error.retryAfterMs !== undefined && error.retryAfterMs <= MAX_PAUSE_TO_SIT_OUT_MS) shortPause = provider;
      }
      const next = order[index + 1];
      if (next) console.warn(`[plan] ${provider.provider} (${provider.model}) ${limited ? 'says to come back later' : `failed (${error.message})`}; this step goes to ${next.provider} (${next.model})`);
    }
  }
  // Or the rested provider due back soonest, if that is soon: it was skipped
  // this time, and is the one that can still plan.
  if (!shortPause) {
    const tried = new Set(order.map(providerKey));
    const soonest = chain
      .filter((provider) => !tried.has(providerKey(provider)))
      .map((provider) => ({ provider, at: resting.get(providerKey(provider)) ?? 0 }))
      .sort((a, b) => a.at - b.at)[0];
    if (soonest && soonest.at - now <= MAX_PAUSE_TO_SIT_OUT_MS) shortPause = soonest.provider;
  }
  if (shortPause) {
    console.warn(`[plan] no other provider could plan; waiting for ${shortPause.provider} (${shortPause.model})`);
    const { maxRateLimitWaitMs: _handOver, ...patient } = shortPause;
    return planOne(patient, request);
  }
  throw rateLimit ?? firstError;
}
