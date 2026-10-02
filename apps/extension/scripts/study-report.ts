/**
 * Every provider-study result so far, side by side: how well each model plans,
 * and how much planning its free tier allows.
 *
 *   pnpm study:report
 *
 * Reads packages/eval/results/study/*.json (from `pnpm study`), prints a
 * Markdown report and writes it next to them as report.md.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SCENARIOS } from "./agent-harness.ts";

const RESULTS = fileURLToPath(new URL("../../../packages/eval/results/study/", import.meta.url));

interface Call { latencyMs: number; repairs: number; promptTokens?: number; completionTokens?: number }
interface Run { task: string; passed: boolean; endedRight: boolean; overreach: boolean; refused?: number; leaked: number; steps: number; unverified: number; calls: Call[]; rateLimitWaits: number; errors: string[]; seconds: number }
interface Study { provider: string; model: string; label?: string; repeats: number; date: string; runs: Run[]; serverErrors?: Record<string, number> }

const name = (study: Study) => `${study.provider}: ${study.model}${study.label ? ` (${study.label})` : ""}`;

/**
 * Free-tier limits, per model, when measured. Groq: from its response
 * headers (1,000 requests a day, 8,000 tokens a minute) and from a 429
 * (7,000 input tokens a minute, seen for qwen3.8-27b; assumed for the others),
 * 30 requests a minute per its docs. NVIDIA: about 40 requests a minute, no
 * daily cap. Ollama: the local GPU's own speed.
 */
const LIMITS: Record<string, { perMinute?: number; perDay?: number; inputTokensPerMinute?: number; tokensPerMinute?: number }> = {
  groq: { perMinute: 30, perDay: 1000, inputTokensPerMinute: 7000, tokensPerMinute: 8000 },
  nvidia: { perMinute: 40 },
  ollama: {},
};

const studies: Study[] = readdirSync(RESULTS)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(`${RESULTS}${name}`, "utf8")) as Study);

const percentile = (values: number[], share: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!;
};
const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const round = (value: number) => (value >= 100 ? Math.round(value).toLocaleString("en-IN") : value.toFixed(1));

const rows = studies.map((study) => {
  const { runs } = study;
  const calls = runs.flatMap((run) => run.calls);
  const withUsage = calls.filter((call) => call.promptTokens !== undefined);
  const promptTokens = mean(withUsage.map((call) => call.promptTokens!));
  const completionTokens = mean(withUsage.map((call) => call.completionTokens!));
  const callsPerTask = mean(runs.map((run) => run.calls.length));
  const limit = LIMITS[study.provider] ?? {};
  const perMinute = Math.min(
    limit.perMinute ?? Infinity,
    limit.inputTokensPerMinute && promptTokens ? limit.inputTokensPerMinute / promptTokens : Infinity,
    limit.tokensPerMinute && promptTokens ? limit.tokensPerMinute / (promptTokens + completionTokens) : Infinity,
  );
  const latencies = calls.map((call) => call.latencyMs / 1000);
  return {
    study,
    passed: runs.filter((run) => run.passed).length,
    endedRight: runs.filter((run) => run.endedRight).length,
    overreach: runs.filter((run) => run.overreach).length,
    refused: runs.reduce((sum, run) => sum + (run.refused ?? 0), 0),
    leaks: runs.reduce((sum, run) => sum + run.leaked, 0),
    stepsWhenPassed: mean(runs.filter((run) => run.passed).map((run) => run.steps)),
    wasted: mean(runs.map((run) => run.unverified)),
    p50: percentile(latencies, 0.5),
    p90: percentile(latencies, 0.9),
    promptTokens,
    completionTokens,
    repairs: calls.reduce((sum, call) => sum + call.repairs, 0),
    errors: runs.reduce((sum, run) => sum + run.errors.length, 0),
    waits: runs.reduce((sum, run) => sum + run.rateLimitWaits, 0),
    stepsPerMinute: perMinute,
    tasksPerDay: limit.perDay ? limit.perDay / Math.max(callsPerTask, 1) : Infinity,
    // What the limits allow, or the model's own speed if that is slower.
    tasksPerHour: Math.min(perMinute * 60, 3600 / Math.max(percentile(latencies, 0.5), 0.1)) / Math.max(callsPerTask, 1),
  };
}).sort((a, b) => b.passed / b.study.runs.length - a.passed / a.study.runs.length);

const lines: string[] = ["# Provider study", ""];
lines.push(`${SCENARIOS.length} agent tasks (apps/extension/scripts/agent-harness.ts), each run several times per model, in Node against the real loop. A run passes when the page ends right, the task ends as it should (done, or giving up when it cannot be done), nothing it was not asked to touch was touched, and no raw personal data reached the server.`, "");
lines.push("| Model | Passed | Ended right | Overreach (clicks refused) | Leaks | Steps (passed) | Wasted steps | Step p50 / p90 | Tokens in + out | Repairs | Errors | Rate-limit waits | Steps/min allowed | Tasks/day allowed |");
lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const row of rows) {
  const { study } = row;
  const total = study.runs.length;
  const infinite = (value: number, unit = "") => (Number.isFinite(value) ? `${round(value)}${unit}` : "no cap");
  lines.push(`| ${name(study)} | **${row.passed} of ${total}** (${Math.round((row.passed / total) * 100)}%) | ${row.endedRight} | ${row.overreach} (${row.refused} refused) | ${row.leaks} | ${row.stepsWhenPassed.toFixed(1)} | ${row.wasted.toFixed(1)} | ${row.p50.toFixed(1)} / ${row.p90.toFixed(1)} s | ${Math.round(row.promptTokens)} + ${Math.round(row.completionTokens)} | ${row.repairs} | ${row.errors} | ${row.waits} | ${infinite(row.stepsPerMinute)} | ${infinite(row.tasksPerDay)} |`);
}
lines.push("", "## Passes per task", "");
lines.push(`| Model | ${SCENARIOS.map((scenario) => scenario.id).join(" | ")} |`);
lines.push(`|---|${SCENARIOS.map(() => "---").join("|")}|`);
for (const row of rows) {
  const cells = SCENARIOS.map((scenario) => {
    const runs = row.study.runs.filter((run) => run.task === scenario.id);
    return runs.length === 0 ? "-" : `${runs.filter((run) => run.passed).length}/${runs.length}`;
  });
  lines.push(`| ${name(row.study)} | ${cells.join(" | ")} |`);
}
const withErrors = rows.filter((row) => Object.keys(row.study.serverErrors ?? {}).length > 0);
if (withErrors.length > 0) {
  lines.push("", "## What the server reported when a step failed", "");
  for (const row of withErrors) {
    for (const [line, count] of Object.entries(row.study.serverErrors!)) lines.push(`- ${name(row.study)}: ${line} (x${count})`);
  }
}
lines.push("", "Steps/min allowed: the free tier's requests a minute, or its tokens a minute divided by this model's tokens a step, whichever is lower. Tasks/day allowed: requests a day divided by requests a task.", "");

const report = lines.join("\n");
console.log(report);
writeFileSync(`${RESULTS}report.md`, report);
