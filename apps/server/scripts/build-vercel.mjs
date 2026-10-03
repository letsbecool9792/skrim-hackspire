#!/usr/bin/env node
/**
 * Builds the planning server for Vercel, in Vercel's Build Output API format.
 * Vercel runs this as the project's build command (apps/server/vercel.json).
 *
 * esbuild bundles src/vercel.ts with every dependency (Hono, Zod, and our
 * @skrim/schema and @skrim/shared, which are TypeScript source) into one
 * file. Vercel then deploys that file as it is: it never has to resolve a
 * workspace package or compile TypeScript, which is where monorepo deploys
 * usually break.
 *
 * The same bundle is deployed once per route ("/" and "/plan"), so each
 * function receives its own path and no rewrite is needed.
 */

import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(SERVER, ".vercel", "output");
const ROUTES = ["index", "plan"];

await rm(OUTPUT, { recursive: true, force: true });

const first = join(OUTPUT, "functions", `${ROUTES[0]}.func`);
await build({
  entryPoints: [join(SERVER, "src", "vercel.ts")],
  outfile: join(first, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  logLevel: "warning",
});

await writeFile(join(first, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs22.x",
  handler: "index.mjs",
  launcherType: "Nodejs",
  // Leave the request stream untouched for Hono to read the body.
  shouldAddHelpers: false,
  // A step can wait out Groq's per-minute limit for up to 30 s, then call
  // the model. 60 s is the Hobby plan's ceiling without Fluid compute.
  maxDuration: 60,
}, null, 2));

for (const route of ROUTES.slice(1)) {
  const dir = join(OUTPUT, "functions", `${route}.func`);
  await mkdir(dirname(dir), { recursive: true });
  await cp(first, dir, { recursive: true });
}

await writeFile(join(OUTPUT, "config.json"), JSON.stringify({ version: 3 }, null, 2));

console.log(`Built .vercel/output: functions ${ROUTES.map((r) => `/${r === "index" ? "" : r}`).join(", ")}`);
