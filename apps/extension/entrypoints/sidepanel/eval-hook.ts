import type { Reading } from "@skrim/eval/reading";

import { PrivateNames } from "@/lib/agent/private-names.ts";
import { readPage } from "@/lib/agent/read-page.ts";
import { tabLink } from "@/lib/agent/tab-link.ts";
import { toEvalReading } from "@/lib/eval-reading.ts";
import { loadNameFinder } from "@/lib/pii/ner-browser.ts";
import { TokenVault } from "@/lib/vault/vault.ts";

/**
 * EVAL BUILDS ONLY (`wxt build --mode eval`; main.tsx imports this only in
 * that mode, so production builds do not contain it). Lets the harness in
 * packages/eval read a fixture tab through exactly the code the agent uses:
 * the content script's extraction, the name rule, GLiNER on ONNX Runtime's
 * WebAssembly, and redaction.
 */

async function readTab(url: string): Promise<Reading> {
  // Not tabs.query({ url }): that takes a match pattern, and a fixture URL has a port.
  const tab = (await browser.tabs.query({})).find((candidate) => candidate.url === url);
  if (tab?.id === undefined) throw new Error(`No tab is showing ${url}`);
  let failed = false;
  const names = new PrivateNames((texts) => loadNameFinder().then((find) => find(texts)), () => { failed = true; });
  const reading = await readPage(tabLink(tab.id), "eval", new AbortController().signal, names, new TokenVault(), 0);
  if (!reading) throw new Error(`The page at ${url} did not answer`);
  return toEvalReading(reading, failed ? "failed" : "on");
}

declare global {
  interface Window {
    __skrimEval?: { readTab: typeof readTab };
  }
}

window.__skrimEval = { readTab };
