import { getRequestListener } from '@hono/node-server';
import { app } from './app.js';

/**
 * The planning server as one Vercel function. scripts/build-vercel.mjs bundles
 * this file, with every dependency, into .vercel/output/, so Vercel runs the
 * bundle as it is and never has to resolve our workspace packages itself.
 *
 * The function is deployed under the path it serves, and Vercel may hand the
 * root function its own name ("/index") as the path: that is still "/".
 */
const listener = getRequestListener(app.fetch);

export default function handler(...args: Parameters<typeof listener>) {
  const [req] = args;
  if (req.url === '/index' || req.url?.startsWith('/index?')) req.url = '/' + req.url.slice('/index'.length);
  return listener(...args);
}
