import type { ModelFile, Resources } from "@skrim/schema";

import { DashboardFeed, DASHBOARD_URL } from "@/lib/agent/dashboard-feed.ts";
import { fetchServerInfo } from "@/lib/agent/server-planner.ts";
import { SERVER_URL } from "./config.ts";

let dashboardTabId: number | null = null;
let modelFiles: ModelFile[] = [];
let planner: Resources["planner"];

/**
 * What each folder of public/models runs on. GLiNER and Tesseract run on
 * WebAssembly (lib/pii/ner-browser.ts, lib/vision/ocr.ts); nothing loads the
 * face model or the icon detector yet.
 */
const RUNS_ON: Record<string, ModelFile["backend"]> = {
  "gliner-pii": "wasm",
  tesseract: "wasm",
  "tesseract-core": "wasm",
};

/** The model sizes `pnpm models:fetch` wrote down. Missing before a re-fetch: then the panel says so. */
async function loadModelFiles(): Promise<void> {
  try {
    const response = await fetch("/models/manifest.json");
    if (!response.ok) return;
    const manifest = (await response.json()) as { models?: { name: string; bytes: number }[] };
    modelFiles = (manifest.models ?? []).map((model) => ({ name: model.name, sizeBytes: model.bytes, backend: RUNS_ON[model.name] ?? "unknown" }));
  } catch {
    modelFiles = [];
  }
}

async function loadPlanner(): Promise<void> {
  const info = await fetchServerInfo(SERVER_URL);
  planner = info ? { provider: info.provider, model: info.model, ...(info.fallback ? { fallback: info.fallback } : {}) } : undefined;
}

/** Every 2 s: find the dashboard tab, and tell it the panel is still open. */
function tick(count: number): void {
  // Querying all tabs and filtering in JS avoids a crash if Chrome strictly
  // requires the "tabs" permission to use the `url` query parameter.
  browser.tabs
    .query({})
    .then((tabs) => {
      const dash = tabs.find((t) => t.url && t.url.startsWith(DASHBOARD_URL));
      dashboardTabId = dash?.id ?? null;
      if (dashboardTabId !== null) feed.heartbeat();
    })
    .catch(() => {
      dashboardTabId = null;
    });
  // The planner can change when the server restarts with another provider.
  if (count % 15 === 0) void loadPlanner();
}

// Create one feed for the lifetime of this side panel.
export const feed = new DashboardFeed({
  getDashboardTabId: () => dashboardTabId,
  getContext: () => ({ modelFiles, ...(planner ? { planner } : {}) }),
});

void loadModelFiles();
let ticks = 0;
tick(ticks);
setInterval(() => tick(++ticks), 2_000);
