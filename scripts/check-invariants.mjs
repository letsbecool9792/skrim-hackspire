#!/usr/bin/env node
/**
 * Guards the rules that, if broken, cost us the project rather than a bug.
 *
 *   pnpm check
 *
 * Runs in CI on every PR. Each failure explains WHY, because the person - or
 * the agent - who tripped it probably has not read the brief, and "rule 3
 * violated" teaches nobody anything.
 *
 * This is deliberately a text scan, not an ESLint plugin. It has to be
 * impossible to disable with an inline comment, and it has to keep working when
 * somebody restructures the lint setup at 3am.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = resolveRoot();
function resolveRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".venv", "dist", "build", ".output", ".wxt",
  "public", "artifacts", "__pycache__",
]);

const CHECKS = [
  {
    id: "no-persistence",
    scope: ["apps/extension"],
    pattern: /\b(localStorage|sessionStorage|indexedDB|chrome\.storage|browser\.storage)\b/,
    allow: [],
    why: [
      "The token vault and every screen graph must be IN-MEMORY ONLY.",
      "Our entire privacy claim is 'nothing persists' (brief section 7), and a judge",
      "will check extension storage after a run. One localStorage.setItem breaks it.",
      "If you need state across a task, hold it in the background worker's memory.",
    ],
  },
  {
    id: "no-raw-console",
    scope: ["apps/extension/lib", "apps/extension/entrypoints"],
    pattern: /\bconsole\.(log|info|warn|error|debug|dir|table)\s*\(/,
    allow: ["packages/shared/src/log.ts"],
    why: [
      "Use `log` from @skrim/shared instead of console.*",
      "A console.log of an object is how PII reaches a crash reporter. The shared",
      "logger scans for raw PII and throws in dev, so mistakes surface immediately",
      "instead of on stage. Log ids and counts, never values.",
    ],
  },
  {
    id: "no-closed-models",
    scope: ["apps", "packages"],
    pattern: /["'](@anthropic-ai\/|@google\/generative-ai|@google\/genai|@mistralai\/|cohere-ai)/,
    allow: [],
    why: [
      "Brief section 4.4 requires an offline-deployable OPEN-WEIGHT model on the server.",
      "Shipping a call to Claude, Gemini or GPT as the planning brain BREAKS THE",
      "PRIVACY CLAIM. Every provider we use speaks the OpenAI-compatible API, so use",
      "the existing adapter with a different baseURL - never a vendor SDK.",
    ],
  },
  {
    id: "schema-imports-nothing",
    scope: ["packages/schema"],
    pattern: /from\s+["'](@skrim\/(?!schema)|\.\.\/\.\.\/apps)/,
    allow: [],
    why: [
      "@skrim/schema is the innermost package. Dependencies point INWARD.",
      "If schema imports from an app or another workspace package, the contract",
      "starts depending on an implementation and the whole point is lost.",
    ],
  },
  {
    id: "no-telemetry",
    scope: ["apps/extension"],
    pattern: /\b(google-analytics|gtag|mixpanel|posthog|amplitude|sentry|datadog)\b/i,
    allow: [],
    why: [
      "No telemetry in the extension. Nothing analytics-shaped at all (brief 7).",
      "A judge reading the manifest and source should find nothing that phones home",
      "except our own planning endpoint.",
    ],
  },
];

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) yield full;
  }
}

function stripCommentsAndStrings(source) {
  // Crude, but enough: prevents a rule tripping on its own documentation.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

async function main() {
  const violations = [];

  for (const check of CHECKS) {
    for (const scope of check.scope) {
      for await (const file of walk(join(ROOT, scope))) {
        const rel = relative(ROOT, file).split(sep).join("/");
        if (check.allow.some((a) => rel === a || rel.startsWith(a))) continue;
        if (rel.endsWith(".test.ts")) continue;

        const source = stripCommentsAndStrings(await readFile(file, "utf8"));
        const lines = source.split("\n");
        lines.forEach((line, i) => {
          if (check.pattern.test(line)) {
            violations.push({ check, file: rel, line: i + 1, text: line.trim().slice(0, 90) });
          }
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log(`\nInvariants OK - ${CHECKS.length} rules, 0 violations.\n`);
    return;
  }

  const byCheck = new Map();
  for (const v of violations) {
    const list = byCheck.get(v.check.id) ?? [];
    list.push(v);
    byCheck.set(v.check.id, list);
  }

  console.error("");
  for (const [id, list] of byCheck) {
    const { why } = list[0].check;
    console.error(`  ${"=".repeat(70)}`);
    console.error(`  INVARIANT VIOLATED: ${id}`);
    console.error(`  ${"=".repeat(70)}`);
    for (const line of why) console.error(`  ${line}`);
    console.error("");
    for (const v of list) console.error(`    ${v.file}:${v.line}   ${v.text}`);
    console.error("");
  }
  console.error(`  ${violations.length} violation(s). Fix them - do not weaken the check.\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`check-invariants crashed: ${err.message}`);
  process.exit(1);
});
