/**
 * THE EVAL: the real extension in Chromium, scored on every annotated fixture.
 *
 *   pnpm eval              # builds the eval extension, then runs this
 *   pnpm eval -- --headed  # watch it
 *   pnpm eval -- --save    # also write SUMMARY.md, the committed copy for the slide
 *
 * Once, before the first run (downloads Playwright's Chromium, ~150 MB):
 *   pnpm --filter @skrim/eval exec playwright install chromium
 *
 * Why Chromium and not Chrome: branded Chrome stopped loading unpacked
 * extensions from the command line in version 137.
 *
 * It serves fixtures/pages over HTTP on two origins (127.0.0.1 and
 * localhost, same port), so the iframe fixture is really cross-origin. It
 * loads the eval build (`wxt build --mode eval`), whose side panel exposes
 * window.__skrimEval, opens the side panel as a tab, and asks it to read each
 * fixture through exactly the code the agent uses (lib/agent/read-page.ts).
 */
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { loadGroundTruth } from "./ground-truth.ts";
import type { Reading } from "./reading.ts";
import { renderReport } from "./report.ts";
import { scoreFixture, summarise, type FixtureScore } from "./score.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PAGES = join(ROOT, "fixtures", "pages");
const EXTENSION = join(ROOT, "apps", "extension", ".output", "chrome-mv3-eval");
const RESULTS = join(ROOT, "packages", "eval", "results");

/** Tall enough that no fixture has elements left out below the view: this scores detection. */
const VIEWPORT = { width: 1280, height: 2400 };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".js": "text/javascript",
  ".css": "text/css",
};

function serveFixtures(): Promise<{ server: Server; port: number }> {
  const server = createServer(async (request, response) => {
    const path = normalize(join(PAGES, decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname)));
    if (!path.startsWith(PAGES + sep) || !existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    let body: Buffer | string = await readFile(path);
    if (path.endsWith(".html")) {
      // The iframe fixture points at the other origin.
      const port = (server.address() as { port: number }).port;
      body = body.toString("utf8").replaceAll("{{OTHER_ORIGIN}}", `http://localhost:${port}`);
    }
    response.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port })));
}

async function main(): Promise<void> {
  if (!existsSync(join(EXTENSION, "manifest.json"))) {
    throw new Error(`No eval build at ${EXTENSION}. Run: pnpm --filter @skrim/extension build:eval`);
  }
  const { server, port } = await serveFixtures();
  const origin = `http://127.0.0.1:${port}`;
  const profile = await mkdtemp(join(tmpdir(), "skrim-eval-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: !process.argv.includes("--headed"),
    viewport: VIEWPORT,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.waitForFunction(() => "__skrimEval" in window, undefined, { timeout: 15_000 });

    const read = async (page: string): Promise<Reading> => {
      const url = `${origin}/${page}`;
      const tab = await context.newPage();
      try {
        await tab.goto(url, { waitUntil: "load" });
        // Text in pixels is read from a capture of the tab on screen.
        await tab.bringToFront();
        return await panel.evaluate(
          (target) => (window as unknown as { __skrimEval: { readTab(url: string): Promise<Reading> } }).__skrimEval.readTab(target),
          url,
        );
      } finally {
        await tab.close();
      }
    };

    const truths = loadGroundTruth(join(ROOT, "fixtures", "ground-truth"));
    // The first reading loads GLiNER; do it once so its load time is not a page's.
    await read(truths[0]!.page);
    const scores: FixtureScore[] = [];
    for (const truth of truths) {
      scores.push(scoreFixture(truth, await read(truth.page)));
      process.stdout.write(".");
    }
    process.stdout.write("\n\n");

    const report = renderReport("Detection on the fixtures (the extension in Chromium)", summarise(scores), scores);
    console.log(report);
    await mkdir(RESULTS, { recursive: true });
    await writeFile(join(RESULTS, "browser-latest.md"), report);
    await writeFile(join(RESULTS, "browser-latest.json"), JSON.stringify(scores, null, 2));
    if (process.argv.includes("--save")) await writeFile(join(ROOT, "packages", "eval", "SUMMARY.md"), `${report}\n`);
    console.log(`Written to packages/eval/results/browser-latest.md${process.argv.includes("--save") ? " and packages/eval/SUMMARY.md" : ""}`);
  } finally {
    await context.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
