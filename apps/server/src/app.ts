import { Hono } from 'hono';
import { PlanRequestSchema, type PlanRequest } from '@skrim/schema';
import { getConfig, overrideConfig } from './config.js';
import { planAction, UnparseableOutputError } from './planner/index.js';
import { ProviderError } from './providers/index.js';

/**
 * The planning server's routes, shared by the local server (index.ts) and the
 * Vercel function (vercel.ts). Nothing here listens on a port.
 */
export const config = getConfig();
export const app = new Hono();

// No CORS: the only client is the extension, and an extension page with host
// permission for this origin is not subject to CORS.

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'Skrim server is running.',
    provider: config.providerConfig.provider,
    model: config.providerConfig.model,
    ...(config.fallbackConfig ? { fallback: { provider: config.fallbackConfig.provider, model: config.fallbackConfig.model } } : {}),
  });
});

/**
 * The main provider plans the step. When it says to come back later (the
 * server already waited out the short pauses), the fallback plans this one.
 * Each step is planned from scratch, so the task carries on.
 */
async function plan(request: PlanRequest, userKey: string | undefined) {
  // A model picked in the side panel, with the user's key from a header.
  const override = request.modelOverride ? overrideConfig(request.modelOverride, userKey) : undefined;
  if (override) return planAction(override, request);
  try {
    return await planAction(config.providerConfig, request);
  } catch (error) {
    const { fallbackConfig } = config;
    if (!fallbackConfig || !(error instanceof ProviderError) || error.kind !== 'rate_limited') throw error;
    console.warn(`[plan] ${config.providerConfig.provider} says to come back later; this step goes to ${fallbackConfig.provider} (${fallbackConfig.model})`);
    return planAction(fallbackConfig, request);
  }
}

app.post('/plan', async (c) => {
  const start = performance.now();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body is not JSON', code: 'invalid_request' }, 400);
  }

  const validation = PlanRequestSchema.safeParse(body);
  if (!validation.success) {
    console.warn(`[plan] rejected: invalid request (${validation.error.issues.length} issues)`);
    return c.json({
      error: 'Invalid request body',
      code: 'invalid_request',
      details: validation.error.format()
    }, 400);
  }

  const request = validation.data;
  // Counts only. Never log the request body: even redacted, "should be free of
  // PII" is not a logging policy.
  const shape = `step ${request.graph.cycle}, ${request.graph.elements.length} elements, ${request.history.length} in history`;

  try {
    // The user's own provider key, for a model picked in the side panel. A
    // header, not the body: the body is what the dashboard shows. Never logged.
    const result = await plan(request, c.req.header('x-provider-key') || undefined);
    const latencyMs = Math.round(performance.now() - start);
    const target = 'target' in result.action && result.action.target ? ` ${result.action.target}` : '';
    const tokens = result.usage ? `, ${result.usage.promptTokens}+${result.usage.completionTokens} tokens` : '';
    console.log(`[plan] ${shape} -> ${result.action.type}${target} in ${latencyMs} ms, ${result.repairs} repairs${tokens}`);
    return c.json({ ...result, latencyMs });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    if (err instanceof ProviderError) {
      const code = err.kind === 'rate_limited' ? 'provider_rate_limited' : 'provider_error';
      // The detail stays in this log; the client gets the short message.
      console.error(`[plan] ${shape} -> ${code} after ${latencyMs} ms: ${err.message}${err.detail ? `\n       provider said: ${err.detail}` : ''}`);
      return c.json({ error: err.message, code }, code === 'provider_rate_limited' ? 429 : 502);
    }
    if (err instanceof UnparseableOutputError) {
      console.error(`[plan] ${shape} -> no valid action after ${err.attempts} attempts, ${latencyMs} ms`);
      return c.json({ error: err.message, code: 'unparseable_model_output' }, 502);
    }
    console.error(`[plan] ${shape} -> internal error after ${latencyMs} ms:`, err);
    return c.json({ error: 'Internal server error', code: 'internal' }, 500);
  }
});
