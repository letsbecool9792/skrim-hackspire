import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { PlanRequestSchema } from '@skrim/schema';
import { getConfig } from './config.js';
import { planAction } from './planner/index.js';

const config = getConfig();
const app = new Hono();

// Note: Ensure cors is imported if needed, but keeping it minimal based on requirements.
// You might need to add `import { cors } from 'hono/cors'` and `app.use('*', cors())` if browser clients access directly without proxy.

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
  
  try {
    const body = await c.req.json();
    const validation = PlanRequestSchema.safeParse(body);
    
    if (!validation.success) {
      return c.json({
        error: 'Invalid request body',
        code: 'invalid_request',
        details: validation.error.format()
      }, 400);
    }
    
    const request = validation.data;
    
    // Call the planner
    const result = await planAction(config.providerConfig, request);
    
    const latencyMs = Math.round(performance.now() - start);
    
    // Privacy claim: NEVER log the request body
    console.log(`[Plan] Action: ${result.action.type}, Latency: ${latencyMs}ms, Repairs: ${result.repairs}, Model: ${result.model}`);
    
    return c.json({
      ...result,
      latencyMs
    });
    
  } catch (err: any) {
    const errorMsg = err.message || 'Unknown error';
    let code = 'internal';
    let status = 500;
    
    if (errorMsg === 'unparseable_model_output') {
      code = 'unparseable_model_output';
      status = 502;
    } else if (errorMsg.includes('Provider error')) {
      code = 'provider_error';
      status = 502;
    } else if (errorMsg.includes('429')) {
      code = 'provider_rate_limited';
      status = 429;
    }
    
    console.error(`[Plan] Error: ${code} - ${errorMsg}`);
    
    return c.json({
      error: errorMsg,
      code
    }, status as any);
  }
});

serve({
  fetch: app.fetch,
  port: config.port
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`);
  console.log(`Provider: ${config.providerConfig.provider} (${config.providerConfig.model})`);
});
