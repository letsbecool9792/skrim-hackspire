#!/usr/bin/env node
/**
 * Smoke test for the planning server. Sends three hand-built requests to a
 * running server and checks the model picks a sensible action for each.
 *
 *   pnpm dev:server       # terminal 1
 *   pnpm smoke:server     # terminal 2
 *
 * Each request is what the extension would send: a redacted screen graph plus a
 * goal. Nothing in here is real user data; the only "PII" is a token.
 * Set SKRIM_SERVER_URL to point somewhere other than localhost:PORT.
 */

const SERVER = process.env.SKRIM_SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

const url = { origin: "http://localhost", pathTemplate: "/click-test.html", hasQuery: false };
const viewport = { width: 1280, height: 720 };
const noRedactions = { regions: [], tokensInPlay: [] };

/** Roughly what extractScreenGraph() produces for fixtures/pages/click-test.html. */
const fixtureElements = (counterText) => [
  { id: "e1", role: "heading", label: "Skrim click test fixture", bbox: [16, 16, 600, 40], source: "dom" },
  { id: "e2", role: "button", label: "Toggle panel", bbox: [16, 100, 120, 32], state: ["collapsed"], source: "dom" },
  { id: "e3", role: "checkbox", label: "Accept terms", bbox: [16, 180, 16, 16], state: ["unchecked"], source: "dom" },
  { id: "e4", role: "button", label: "Increment counter", value: counterText, bbox: [16, 250, 120, 32], source: "dom" },
  { id: "e5", role: "button", label: "Details", bbox: [16, 320, 120, 32], state: ["collapsed"], source: "dom" },
  { id: "e6", role: "link", label: "Go to section 2", bbox: [16, 390, 140, 20], source: "dom" },
];

const SCENARIOS = [
  {
    name: "click",
    request: {
      goal: "Increment the counter",
      graph: { cycle: 0, url, title: "Skrim click test fixture", viewport, elements: fixtureElements("Count: 0"), manifest: noRedactions },
      history: [],
    },
    expect: (a) => a.type === "click" && a.target === "e4",
    expected: "click on e4 (the counter button)",
  },
  {
    name: "referential redaction",
    request: {
      goal: "Enter my email address in the email field",
      graph: {
        cycle: 0,
        url: { origin: "https://shop.example", pathTemplate: "/login", hasQuery: false },
        title: "Sign in",
        viewport,
        elements: [
          { id: "e1", role: "heading", label: "Sign in", bbox: [16, 16, 300, 40], source: "dom" },
          { id: "e2", role: "textbox", label: "Email", bbox: [16, 80, 300, 36], state: ["editable", "required"], source: "dom" },
          { id: "e3", role: "textbox", label: "Password", bbox: [16, 130, 300, 36], state: ["editable", "required"], source: "dom" },
          { id: "e4", role: "button", label: "Continue", bbox: [16, 190, 120, 36], source: "dom" },
        ],
        manifest: { regions: [], tokensInPlay: ["<PII:EMAIL:1>"] },
      },
      history: [],
      extracted: { my_email: "<PII:EMAIL:1>" },
    },
    expect: (a) => a.type === "type" && a.target === "e2" && a.value === "<PII:EMAIL:1>",
    expected: 'type "<PII:EMAIL:1>" into e2 - the token, never a made-up address',
  },
  {
    name: "knows when to stop",
    request: {
      goal: "Increment the counter once",
      graph: { cycle: 1, url, title: "Skrim click test fixture", viewport, elements: fixtureElements("Count: 1"), manifest: noRedactions },
      history: [{ cycle: 0, action: { type: "click", target: "e4" }, verified: true }],
    },
    expect: (a) => a.type === "done" && a.success === true,
    expected: "done with success: true",
  },
];

async function main() {
  let health;
  try {
    health = await (await fetch(`${SERVER}/`)).json();
  } catch {
    console.error(`\nNo server at ${SERVER}. Start it in another terminal first:\n\n  pnpm dev:server\n`);
    process.exit(1);
  }
  console.log(`\nServer ${SERVER} - provider ${health.provider}, model ${health.model}\n`);

  let failures = 0;
  for (const [i, s] of SCENARIOS.entries()) {
    console.log(`[${i + 1}/${SCENARIOS.length}] ${s.name}: "${s.request.goal}"`);
    const started = Date.now();
    let res;
    try {
      // Longer than the server's own provider timeout (60 s hosted, 120 s
      // Ollama), so the server's more specific error is what shows.
      res = await fetch(`${SERVER}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s.request),
        signal: AbortSignal.timeout(150_000),
      });
    } catch (err) {
      failures++;
      console.log(`  x no response within 150 s (${err.name})\n`);
      continue;
    }
    const body = await res.json();
    const ms = Date.now() - started;

    if (!res.ok) {
      failures++;
      console.log(`  x HTTP ${res.status} ${body.code}: ${String(body.error).slice(0, 300)}`);
      if (body.details) console.log(`    ${JSON.stringify(body.details).slice(0, 300)}`);
      console.log("");
      continue;
    }

    const ok = s.expect(body.action);
    if (!ok) failures++;
    console.log(`  -> ${JSON.stringify(body.action)}`);
    console.log(`  ${ok ? "ok" : "x "} expected ${s.expected}`);
    console.log(`  server ${body.latencyMs} ms, round trip ${ms} ms, repairs ${body.repairs}\n`);
  }

  console.log(failures === 0 ? "All scenarios passed.\n" : `${failures} of ${SCENARIOS.length} scenarios failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
