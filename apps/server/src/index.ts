import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { PlanRequestSchema } from '@skrim/schema';
import { getConfig } from './config.js';
import { planAction, UnparseableOutputError } from './planner/index.js';
import { ProviderError } from './providers/index.js';

const config = getConfig();
const app = new Hono();

// No CORS: the only client is the extension, and an extension page with host
// permission for this origin is not subject to CORS.

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'Skrim server is running.',
    provider: config.providerConfig.provider,
    model: config.providerConfig.model
  });
});

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
    const result = await planAction(config.providerConfig, request);
    const latencyMs = Math.round(performance.now() - start);
    const target = 'target' in result.action && result.action.target ? ` ${result.action.target}` : '';
    console.log(`[plan] ${shape} -> ${result.action.type}${target} in ${latencyMs} ms, ${result.repairs} repairs`);
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

const server = serve({
  fetch: app.fetch,
  port: config.port
}, (info) => {
  console.log(`Skrim server on http://localhost:${info.port}`);
  console.log(`Provider: ${config.providerConfig.provider}, model: ${config.providerConfig.model}`);
  console.log('Each /plan request logs one line here (counts only, never content).');
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error;
  // The usual cause: a server from earlier is still running in another
  // terminal, maybe with a different MODEL_PROVIDER. Say so instead of a stack trace.
  console.error(`\nPort ${config.port} is already in use, most likely by a Skrim server started earlier in another terminal.`);
  console.error('Stop that one (Ctrl+C in its terminal), or see what holds the port with:');
  console.error(`  Get-NetTCPConnection -LocalPort ${config.port} -State Listen | Select-Object OwningProcess\n`);
  process.exit(1);
});
