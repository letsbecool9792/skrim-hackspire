/**
 * THE PROVIDER STUDY, one model per run: how well it plans (the 14 agent
 * tasks, several times each) and how much of a free tier each step uses.
 *
 *   pnpm study -- groq:qwen/qwen3.8-27b
 *   pnpm study -- nvidia:openai/gpt-oss-20b --repeats 2
 *   pnpm study -- ollama:qwen3-vl:4b-instruct --tasks counter,signup
 *   pnpm study:report          # every result so far, side by side
 *
 * Starts its own planning server for the model, on a free port, with the keys
 * from the root .env; your `pnpm dev:server` is untouched. Runs of different
 * models can go in parallel, each in its own terminal. When the provider
 * says "rate limit", the run waits and retries, and counts the wait: the
 * study measures planning, and reports the limits separately.
 *
 * Results: packages/eval/results/study/<model>.json (gitignored). What is real
 * and what is simulated: scripts/agent-harness.ts.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import type { PlanResponse } from "@skrim/schema";

import { createHarness, SCENARIOS } from "./agent-harness.ts";

const { createServerPlanner, fetchServerInfo, PlannerError } = await import("../lib/agent/server-planner.ts");

const args = process.argv.slice(2);
const spec = args.find((arg) => !arg.startsWith("--") && /^(groq|nvidia|ollama):/.test(arg));
const option = (name: string) => args[args.indexOf(`--${name}`) + 1];
const repeats = args.includes("--repeats") ? Number(option("repeats")) : 3;
// Commas or spaces: PowerShell turns "a,b" into "a b".
const onlyTasks = args.includes("--tasks") ? option("tasks")!.split(/[\s,]+/) : undefined;
if (!spec) {
  console.error("Say which model: pnpm study -- groq:qwen/qwen3.8-27b (provider groq, nvidia or ollama, then the model id)");
  process.exit(1);
}
const provider = spec.slice(0, spec.indexOf(":"));
const model = spec.slice(spec.indexOf(":") + 1);
const scenarios = onlyTasks ? SCENARIOS.filter((scenario) => onlyTasks.includes(scenario.id)) : SCENARIOS;
if (scenarios.length === 0) {
  console.error(`No such task. The tasks are: ${SCENARIOS.map((scenario) => scenario.id).join(", ")}`);
  process.exit(1);
}

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RESULTS = `${ROOT}packages/eval/results/study/`;
/** How long to wait after a "rate limit" before asking again, and how often. */
const RATE_LIMIT_WAIT_MS = 10_000;
const RATE_LIMIT_TRIES = 12;

/** Model settings the server takes from the environment. */
function modelEnvironment(): Record<string, string> {
  const env: Record<string, string> = { MODEL_PROVIDER: provider, [`${provider.toUpperCase()}_MODEL`]: model };
  // Groq's gpt-oss cannot switch reasoning off; "low" is its least.
  if (provider === "groq" && model.includes("gpt-oss")) env.GROQ_REASONING_EFFORT = "low";
  return env;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const server = spawn(process.execPath, ["--import", "tsx", "--env-file-if-exists=../../.env", "src/index.ts"], {
  cwd: `${ROOT}apps/server`,
  env: { ...process.env, ...modelEnvironment(), PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverErrors = "";
server.stderr.on("data", (chunk) => { serverErrors = (serverErrors + chunk).slice(-2000); });
const stopServer = () => { if (server.exitCode === null) server.kill(); };
process.on("exit", stopServer);

const serverUrl = `http://127.0.0.1:${port}`;
let info = null;
for (let waited = 0; !info && waited < 60_000 && server.exitCode === null; waited += 500) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  info = await fetchServerInfo(serverUrl);
}
if (!info) {
  console.error(`The planning server did not start for ${spec}.\n${serverErrors}`);
  process.exit(1);
}

const harness = await createHarness();
const planner = createServerPlanner(serverUrl);
console.log(`\n${spec}: ${scenarios.length} tasks x ${repeats}, name detection ${harness.findNames ? "on" : "OFF"}\n`);

interface Call {
  latencyMs: number;
  repairs: number;
  promptTokens?: number;
  completionTokens?: number;
}

const runs = [];
for (let repeat = 1; repeat <= repeats; repeat++) {
  for (const scenario of scenarios) {
    const calls: Call[] = [];
    let rateLimitWaits = 0;
    const errors: string[] = [];
    let waitedMs = 0;
    const started = Date.now();
    const result = await harness.run(
      scenario,
      async (request, signal) => {
        for (let attempt = 0; ; attempt++) {
          try {
            const response: PlanResponse = await planner(request, signal);
            calls.push({ latencyMs: response.latencyMs, repairs: response.repairs, ...(response.usage ? { promptTokens: response.usage.promptTokens, completionTokens: response.usage.completionTokens } : {}) });
            return response;
          } catch (error) {
            if (error instanceof PlannerError && error.code === "provider_rate_limited" && attempt < RATE_LIMIT_TRIES) {
              rateLimitWaits++;
              waitedMs += RATE_LIMIT_WAIT_MS;
              await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
              continue;
            }
            errors.push(error instanceof PlannerError ? error.code : "other");
            throw error;
          }
        }
      },
      undefined,
      30 * 60_000,
    );
    const unverified = result.events.filter((event) => event.type === "acted" && !event.verified).length;
    runs.push({
      task: scenario.id,
      repeat,
      passed: result.passed,
      pageOk: result.pageOk,
      endedRight: result.endedRight,
      overreach: result.overreach.length > 0,
      leaked: result.leaked.length,
      outcome: result.finished.outcome,
      errorCode: result.finished.errorCode ?? null,
      steps: result.finished.steps,
      unverified,
      calls,
      rateLimitWaits,
      errors,
      /** Wall time without the rate-limit waits. */
      seconds: (Date.now() - started - waitedMs) / 1000,
    });
    const mark = result.passed ? "pass" : "FAIL";
    const why = result.passed ? "" : [!result.pageOk && "page wrong", !result.endedRight && `ended ${result.finished.errorCode ?? result.finished.outcome}`, result.overreach.length > 0 && "overreach", result.leaked.length > 0 && "LEAK"].filter(Boolean).join(", ");
    console.log(`${mark} ${String(repeat)}/${repeats} ${scenario.id.padEnd(13)} ${String(result.finished.steps).padStart(2)} steps${rateLimitWaits ? `, ${rateLimitWaits} rate-limit waits` : ""}${why ? `  (${why})` : ""}`);
  }
}

mkdirSync(RESULTS, { recursive: true });
const file = `${RESULTS}${spec.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
writeFileSync(file, JSON.stringify({ provider, model, repeats, date: new Date().toISOString(), runs }, null, 2));
const passed = runs.filter((run) => run.passed).length;
console.log(`\n${spec}: ${passed} of ${runs.length} passed. Written to ${file.slice(ROOT.length)}`);
stopServer();
process.exit(0);
