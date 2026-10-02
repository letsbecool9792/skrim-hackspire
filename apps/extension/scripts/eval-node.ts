/**
 * The eval fixtures, scored in Node: a quick check while changing detection,
 * and a check that the fixtures and their ground truth agree.
 *
 *   pnpm --filter @skrim/extension eval:node
 *
 * NOT the reported numbers. Those come from the real extension in Chromium
 * (`pnpm eval`, packages/eval/src/browser.ts), because this runs a different
 * runtime: happy-dom has no layout (elements get made-up positions, canvas
 * and frames are empty) and GLiNER runs on onnxruntime-node. The detection
 * code is the same: extraction, the name rule and redaction, via readPage().
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { loadGroundTruth, renderReport, scoreFixture, summarise, type FixtureScore } from "@skrim/eval";
import { setLogLevel } from "@skrim/shared";

// A tall window: the eval scores detection, so no element is left out for
// being below the view.
GlobalRegistrator.register({ url: "http://localhost/fixtures/pages/", width: 1280, height: 100_000 });
setLogLevel("error");
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
const { PrivateNames } = await import("../lib/agent/private-names.ts");
const { readPage } = await import("../lib/agent/read-page.ts");
const { toEvalReading } = await import("../lib/eval-reading.ts");
const { loadNameFinderNode } = await import("../lib/pii/ner-node.ts");
const { TokenVault } = await import("../lib/vault/vault.ts");

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const RESULTS = fileURLToPath(new URL("../../../packages/eval/results/", import.meta.url));

function loadPage(file: string): void {
  history.replaceState(null, "", `/fixtures/pages/${file}`);
  const parsed = new DOMParser().parseFromString(readFileSync(`${FIXTURES}pages/${file}`, "utf8"), "text/html");
  document.title = parsed.title;
  document.head.replaceChildren(...parsed.head.childNodes);
  document.body.replaceChildren(...parsed.body.childNodes);
  for (const script of document.querySelectorAll("script")) {
    try {
      new Function(script.textContent ?? "")();
    } catch {
      // happy-dom has no canvas; a page script that needs one simply does not draw.
    }
  }
}

const findNames = (await loadNameFinderNode()) ?? undefined;
if (!findNames) console.warn("GLiNER is not fetched (pnpm models:fetch): names are caught only by rules.\n");
initObserver();
registerScreenGraphProvider(domScreenGraphProvider);
const handle = createContentHandler(getObservationVersion);
const link = {
  send: async (message: unknown) => JSON.parse(JSON.stringify((await handle(JSON.parse(JSON.stringify(message)))) ?? null)) ?? undefined,
  watchNavigation: () => ({ started: false, whenStarted: async () => false, loaded: async () => true, stop: () => {} }),
};

const scores: FixtureScore[] = [];
for (const truth of loadGroundTruth(`${FIXTURES}ground-truth/`)) {
  loadPage(truth.page);
  await new Promise((resolve) => setTimeout(resolve, 0));
  let failed = false;
  const names = new PrivateNames(findNames, () => { failed = true; });
  const reading = await readPage(link, "eval", new AbortController().signal, names, new TokenVault(), 0);
  if (!reading) throw new Error(`${truth.page}: the page did not answer`);
  scores.push(scoreFixture(truth, toEvalReading(reading, !findNames ? "off" : failed ? "failed" : "on")));
}

const report = renderReport("Detection on the fixtures (Node check, not the reported numbers)", summarise(scores), scores);
console.log(report);
mkdirSync(RESULTS, { recursive: true });
writeFileSync(`${RESULTS}node-latest.md`, report);
writeFileSync(`${RESULTS}node-latest.json`, JSON.stringify(scores, null, 2));
console.log(`\nWritten to packages/eval/results/node-latest.md`);
process.exit(0);
