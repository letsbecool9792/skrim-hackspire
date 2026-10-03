import { serve } from '@hono/node-server';
import { app, config } from './app.js';

const server = serve({
  fetch: app.fetch,
  port: config.port
}, (info) => {
  console.log(`Skrim server on http://localhost:${info.port}`);
  console.log(`Provider: ${config.providerConfig.provider}, model: ${config.providerConfig.model}`);
  if (config.fallbackConfig) console.log(`When it says to come back later: ${config.fallbackConfig.provider}, model: ${config.fallbackConfig.model}`);
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
