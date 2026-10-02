import type { PageObservationMessage } from "../messages.ts";
import { parseMessage } from "../messages.ts";
import { pixelTargets, withPixelText, type PixelReader } from "../vision/read-pixels.ts";
import type { TokenVault } from "../vault/vault.js";
import type { PageLink } from "./loop.ts";
import type { PrivateNames } from "./private-names.ts";
import { pageTexts, redactPage, type RedactedPage } from "./redact.ts";

/**
 * One reading of a page: observe it, read the text that exists only as
 * pixels, decide which names are private, redact it. The agent loop does this
 * every step, and the eval harness (packages/eval) scores exactly this, so
 * the numbers describe the code that runs.
 */
export interface PageReading {
  /** RAW, as the content script reported it, plus any text read from pixels. Never sent anywhere. */
  observation: PageObservationMessage;
  /** What the server would receive for this view. */
  page: RedactedPage;
  /** Whether the page shows the user's data, so every name on it is hidden. */
  personal: boolean;
  timings: { observeMs: number; visionMs: number; namesMs: number; redactMs: number };
}

export async function readPage(link: PageLink, taskId: string, signal: AbortSignal, names: PrivateNames, vault: TokenVault, cycle: number, pixels?: PixelReader): Promise<PageReading | null> {
  const started = performance.now();
  let observation = await observe(link, taskId, signal);
  if (!observation) return null;
  const observed = performance.now();

  const targets = pixels && observation.elements ? pixelTargets(observation.elements) : [];
  if (pixels && targets.length > 0) {
    const lines = await pixels(targets, observation.viewport ?? { width: 0, height: 0 });
    signal.throwIfAborted();
    if (lines && lines.length > 0) observation = { ...observation, elements: withPixelText(observation.elements ?? [], lines) };
  }
  const seen = performance.now();

  const view = await names.preparePage(observation, pageTexts(observation));
  signal.throwIfAborted();
  const named = performance.now();
  const page = redactPage(observation, cycle, vault, view.lookup);
  return {
    observation,
    page,
    personal: view.personal,
    timings: { observeMs: observed - started, visionMs: seen - observed, namesMs: named - seen, redactMs: performance.now() - named },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

async function observe(link: PageLink, taskId: string, signal: AbortSignal): Promise<PageObservationMessage | null> {
  // Right after a page load the new page's content script may not be ready.
  for (let attempt = 0; attempt < 4; attempt++) {
    const reply = parseMessage(await link.send({ type: "page.observe", taskId }));
    signal.throwIfAborted();
    if (reply?.type === "page.observation") return reply;
    await sleep(400, signal);
  }
  return null;
}
