/**
 * Runs the real agent loop on the fixture pages, in Node, against a running
 * planning server. The quickest way to see the whole loop work, or not.
 *
 *   pnpm dev:server      # terminal 1
 *   pnpm test:agent      # terminal 2
 *
 * Real: the DOM extractor, PII redaction and vault, the action executor, the
 * server planner with its outbound PII check, the server and the model.
 * Simulated: the browser. Pages load into happy-dom, which has no layout
 * engine, so elements get made-up positions in document order; messages to
 * the page are function calls instead of browser messaging.
 *
 * It is not the eval harness (that drives a real browser; see packages/eval).
 * Set SKRIM_SERVER_URL to use a server other than localhost:3000.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PlanRequest } from "@skrim/schema";
import { setLogLevel } from "@skrim/shared";

// happy-dom replaces fetch with one that enforces CORS, which the extension
// does not face (it has host permission for the server). Keep Node's.
const native = { fetch, Request, Response, Headers, AbortController, AbortSignal };
GlobalRegistrator.register({ url: "http://localhost/fixtures/pages/", width: 1280, height: 720 });
Object.assign(globalThis, native);
setLogLevel("warn");

// No layout engine: stack elements top to bottom in document order, and give
// anything inside a display:none subtree no size, as a browser would.
Element.prototype.getBoundingClientRect = function (this: Element) {
  for (let node: Element | null = this; node; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return new DOMRect(0, 0, 0, 0);
  }
  const index = Array.prototype.indexOf.call(document.querySelectorAll("body *"), this);
  return new DOMRect(20, 20 + Math.max(index, 0) * 28, 600, 24);
};
Element.prototype.scrollIntoView = () => {};

const { getObservationVersion, initObserver } = await import("../entrypoints/content/observer.ts");
const { createContentHandler } = await import("../lib/content-handler.ts");
const { domScreenGraphProvider } = await import("../lib/dom/provider.ts");
const { registerScreenGraphProvider } = await import("../lib/integration.ts");
const { runAgentTask } = await import("../lib/agent/loop.ts");
const { createServerPlanner, fetchServerInfo } = await import("../lib/agent/server-planner.ts");
const { loadNameFinderNode } = await import("../lib/pii/ner-node.ts");

const SERVER_URL = (process.env.SKRIM_SERVER_URL ?? "http://localhost:3000").replace(/\/$/, "");
const FIXTURES = fileURLToPath(new URL("../../../fixtures/pages/", import.meta.url));

interface Scenario {
  page: string;
  goal: string;
  /** What the page must look like afterwards. */
  check: () => boolean;
  expected: string;
  /** Raw values that must never appear in a request to the server. */
  secrets?: string[];
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SCENARIOS: Scenario[] = [
  { page: "click-test.html", goal: "Increment the counter once", check: () => byId("counter").textContent === "Count: 1", expected: "the counter shows Count: 1" },
  { page: "click-test.html", goal: "Click show panel", check: () => byId("toggle-panel").classList.contains("visible"), expected: "the panel is open" },
  { page: "click-test.html", goal: "Accept the terms", check: () => byId<HTMLInputElement>("check1").checked, expected: "the checkbox is ticked" },
  { page: "click-test.html", goal: "Open the details section", check: () => byId("accordion-panel").classList.contains("visible"), expected: "the accordion is open" },
  {
    page: "form-test.html",
    goal: "Send support a message saying my parcel is late. Use my email from the account box.",
    check: () => byId<HTMLInputElement>("email").value === "asha.rao@example.com" && /Thanks/.test(byId("status").textContent ?? ""),
    expected: "the form was sent with the account's email",
    // The name and address are only caught by the GLiNER model.
    secrets: ["asha.rao@example.com", "+91 98765 43210", "98765 43210", "Asha Rao", "12 MG Road"],
  },
];

function loadPage(file: string): void {
  history.replaceState(null, "", `/fixtures/pages/${file}`);
  const parsed = new DOMParser().parseFromString(readFileSync(`${FIXTURES}${file}`, "utf8"), "text/html");
  // Swap the contents, not the <body> itself: the content script's
  // MutationObserver is attached to the body element.
  document.head.replaceChildren(...parsed.head.childNodes);
  document.body.replaceChildren(...parsed.body.childNodes);
  // Our own fixture scripts, run like a page would run them.
  for (const script of document.querySelectorAll("script")) new Function(script.textContent ?? "")();
}

const info = await fetchServerInfo(SERVER_URL);
if (!info) {
  console.error(`\nNo server at ${SERVER_URL}. Start it in another terminal first:\n\n  pnpm dev:server\n`);
  process.exit(1);
}
const findNames = (await loadNameFinderNode()) ?? undefined;
console.log(`\nServer ${SERVER_URL} - provider ${info.provider}, model ${info.model}`);
console.log(`Name and address detection: ${findNames ? "on (GLiNER)" : "OFF - run pnpm models:fetch"}\n`);

initObserver();
registerScreenGraphProvider(domScreenGraphProvider);
const handle = createContentHandler(getObservationVersion);
const serverPlanner = createServerPlanner(SERVER_URL);

let failures = 0;
for (const [index, scenario] of SCENARIOS.entries()) {
  loadPage(scenario.page);
  await new Promise((resolve) => setTimeout(resolve, 0));
  console.log(`[${index + 1}/${SCENARIOS.length}] ${scenario.page}: "${scenario.goal}"`);

  const requests: PlanRequest[] = [];
  const started = Date.now();
  let summary = "";
  await runAgentTask({
    goal: scenario.goal,
    planner: async (request, signal) => {
      requests.push(request);
      return serverPlanner(request, signal);
    },
    link: {
      // Like browser messaging: only JSON-safe data crosses.
      send: async (message) => JSON.parse(JSON.stringify((await handle(JSON.parse(JSON.stringify(message)))) ?? null)) ?? undefined,
      watchNavigation: () => ({ started: false, loaded: async () => true, stop: () => {} }),
    },
    signal: new AbortController().signal,
    findNames,
    onEvent: (event) => {
      if (event.type === "planned") {
        const { reason: _reason, ...action } = event.action;
        const label = event.targetLabel ? ` "${event.targetLabel}"` : "";
        process.stdout.write(`  ${event.step + 1}. ${JSON.stringify(action)}${label} (${(event.latencyMs / 1000).toFixed(1)} s)`);
        if (event.action.type === "done") process.stdout.write("\n");
      }
      if (event.type === "acted") console.log(event.verified ? " -> verified" : ` -> NOT verified: ${event.note}`);
      if (event.type === "finished") {
        summary = `${event.outcome}${event.errorCode ? ` (${event.errorCode})` : ""}${event.message ? `: ${event.message}` : ""}`;
      }
    },
  });

  const leaked = (scenario.secrets ?? []).filter((secret) => requests.some((request) => JSON.stringify(request).includes(secret)));
  const pageOk = scenario.check();
  const ok = pageOk && leaked.length === 0;
  if (!ok) failures++;
  console.log(`  task ${summary}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  ${pageOk ? "ok" : "x "} expected ${scenario.expected}`);
  if (scenario.secrets) console.log(`  ${leaked.length === 0 ? "ok" : "x "} raw personal data sent to the server: ${leaked.length === 0 ? "none" : `${leaked.length} value(s)`}`);
  console.log("");
}

console.log(failures === 0 ? "All scenarios passed.\n" : `${failures} of ${SCENARIOS.length} scenarios failed.\n`);
process.exit(failures === 0 ? 0 : 1);
