/**
 * Runs the real agent loop on the fixture pages, in Node, against a running
 * planning server. The quickest way to see the whole loop work, or not.
 *
 *   pnpm dev:server      # terminal 1
 *   pnpm test:agent      # terminal 2: the six quick goals
 *   pnpm test:agent -- --all   # all fourteen, as the provider study runs them
 *   pnpm test:agent -- --tasks result,signup   # just these, step by step
 *
 * What is real and what is simulated: scripts/agent-harness.ts. It is not the
 * eval harness (that drives a real browser; see packages/eval). Set
 * SKRIM_SERVER_URL to use a server other than localhost:3000.
 */
import { createHarness, SCENARIOS } from "./agent-harness.ts";

const { createServerPlanner, fetchServerInfo } = await import("../lib/agent/server-planner.ts");

const SERVER_URL = (process.env.SKRIM_SERVER_URL ?? "http://localhost:3000").replace(/\/$/, "");
const args = process.argv.slice(2);
// Commas or spaces: PowerShell turns "a,b" into "a b".
const onlyTasks = args.includes("--tasks") ? args[args.indexOf("--tasks") + 1]?.split(/[\s,]+/) : undefined;
const scenarios = onlyTasks
  ? SCENARIOS.filter((scenario) => onlyTasks.includes(scenario.id))
  : args.includes("--all") ? SCENARIOS : SCENARIOS.filter((scenario) => scenario.quick);
if (scenarios.length === 0) {
  console.error(`No such task. The tasks are: ${SCENARIOS.map((scenario) => scenario.id).join(", ")}`);
  process.exit(1);
}

const info = await fetchServerInfo(SERVER_URL);
if (!info) {
  console.error(`\nNo server at ${SERVER_URL}. Start it in another terminal first:\n\n  pnpm dev:server\n`);
  process.exit(1);
}
const harness = await createHarness();
console.log(`\nServer ${SERVER_URL} - provider ${info.provider}, model ${info.model}`);
console.log(`Name and address detection: ${harness.findNames ? "on (GLiNER)" : "OFF - run pnpm models:fetch"}\n`);

const serverPlanner = createServerPlanner(SERVER_URL);
let failures = 0;
for (const [index, scenario] of scenarios.entries()) {
  console.log(`[${index + 1}/${scenarios.length}] ${scenario.page}: "${scenario.goal}"`);
  const started = Date.now();
  const result = await harness.run(
    scenario,
    async (request, signal) => {
      // What the planner was told about the step before: the note it decides by.
      const note = request.history.at(-1)?.note;
      if (note) console.log(`     told: ${note}`);
      return serverPlanner(request, signal);
    },
    (event) => {
      if (event.type === "planned") {
        const { reason: _reason, ...action } = event.action;
        const label = event.targetLabel ? ` "${event.targetLabel}"` : "";
        process.stdout.write(`  ${event.step + 1}. ${JSON.stringify(action)}${label} (${(event.latencyMs / 1000).toFixed(1)} s)`);
        if (event.action.type === "done") process.stdout.write("\n");
      }
      if (event.type === "acted") console.log(event.verified ? " -> verified" : ` -> NOT verified: ${event.note}`);
    },
  );
  const { finished } = result;
  if (!result.passed) failures++;
  console.log(`  task ${finished.outcome}${finished.errorCode ? ` (${finished.errorCode})` : ""}${finished.message ? `: ${finished.message}` : ""}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  ${result.pageOk ? "ok" : "x "} expected ${scenario.expected}`);
  if (!result.endedRight) console.log(`  x  expected the task to end ${scenario.ending === "gives up" ? "by giving up" : "done"}`);
  if (result.overreach.length > 0) console.log(`  x  acted on what nobody asked for: ${[...new Set(result.overreach)].join(", ")}`);
  if (scenario.secrets) console.log(`  ${result.leaked.length === 0 ? "ok" : "x "} raw personal data sent to the server: ${result.leaked.length === 0 ? "none" : `${result.leaked.length} value(s)`}`);
  console.log("");
}

console.log(failures === 0 ? "All scenarios passed.\n" : `${failures} of ${scenarios.length} scenarios failed.\n`);
process.exit(failures === 0 ? 0 : 1);
