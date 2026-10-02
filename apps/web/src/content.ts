/**
 * src/content.ts — every number and piece of copy on the landing page lives here.
 * Updating a metric is a one-line change. Numbers come from BRIEF.md §13 only;
 * nothing is invented.
 */

export const SITE = {
  title: "Skrim",
  tagline: "An AI agent that does tasks on your behalf — and never shows the server your data.",
  githubUrl: "https://github.com/letsbecool9792/skrim-hackspire",
  team: "tropical crush",
} as const;

// ─── Hero visual — fictional data from fixtures/pages/checkout.html ────────────

export const HERO_ROWS = [
  { label: "Name",    value: "Priya Sharma",         tokenLabel: "name 1" },
  { label: "Email",   value: "priya@example.com",    tokenLabel: "email 1" },
  { label: "Phone",   value: "+91 90000 12345",      tokenLabel: "phone 1" },
  { label: "Order",   value: "SKU-88213-B  ₹4,999",  tokenLabel: null },
] as const;

// ─── Pipeline steps (§ "How it works" from BRIEF.md §5 + §6) ──────────────────

export interface PipelineStep {
  icon: string; // lucide icon name
  title: string;
  detail: string;
}

export const PIPELINE: PipelineStep[] = [
  {
    icon: "Eye",
    title: "Read the page",
    detail:
      "The extension walks the live DOM — roles, labels, values — and captures rendered pixels for anything the DOM cannot describe.",
  },
  {
    icon: "ScanText",
    title: "Find personal data",
    detail:
      "A local NER model spots names and addresses in text. Regex catches structured formats: emails, phone numbers, card numbers. Both run on your device.",
  },
  {
    icon: "ShieldCheck",
    title: "Swap for placeholders",
    detail:
      "Each private value becomes a typed token — \u003cPII:EMAIL:1\u003e. A lookup table maps it back to the real value. That table never leaves your machine.",
  },
  {
    icon: "Brain",
    title: "Plan on the server",
    detail:
      "The scrubbed description goes to an open-weight model. It returns one action: \u201cclick button in row 3.\u201d No personal data ever crossed the wire.",
  },
  {
    icon: "MousePointerClick",
    title: "Act on the device",
    detail:
      "The extension carries out the action locally. When the plan says \u2018type <PII:EMAIL:1>\u2019, it looks up the real address and types it \u2014 privately, at that moment only.",
  },
];

// ─── Numbers from BRIEF.md §13 ─────────────────────────────────────────────────
// Only values explicitly stated in the document are included. Nothing is invented.

export interface Metric {
  value: string;
  label: string;
  detail: string;
}

export const METRICS: Metric[] = [
  {
    value: "63.6 MB",
    label: "On-device footprint",
    detail: "Total model + runtime size cached in the browser after first run.",
  },
  {
    value: "~76 MB",
    label: "With icon detector",
    detail: "Once the OmniParser YOLO icon detector is exported and bundled.",
  },
  {
    value: "6 GB",
    label: "VRAM on dev machine",
    detail: "RTX 4050 Laptop. ~4.5 GB free after Windows and Chrome.",
  },
];

export interface FootprintRow {
  asset: string;
  size: string;
}

export const FOOTPRINT_ROWS: FootprintRow[] = [
  { asset: "GLiNER PII, quantised uint8 ONNX", size: "44.7 MB" },
  { asset: "GLiNER tokenizer + configs",        size: "3.5 MB"  },
  { asset: "MediaPipe vision WASM (SIMD only)", size: "11.5 MB" },
  { asset: "Tesseract core WASM (LSTM + SIMD)", size: "2.8 MB"  },
  { asset: "Tesseract eng.traineddata.gz",      size: "1.9 MB"  },
  { asset: "BlazeFace short-range",             size: "0.2 MB"  },
  { asset: "OmniParser icon detector (pending export)", size: "~12 MB" },
];

// ─── Known limits ──────────────────────────────────────────────────────────────

export const KNOWN_LIMITS: string[] = [
  "Detection is statistical — recall will never be exactly 100%. We publish our numbers; we do not claim perfection.",
  "Screen capture is hard-capped at roughly 2 calls per second by the browser. Loop frequency is bounded by this ceiling.",
  "A 2B local model is unlikely to plan multi-step tasks reliably; 4B is borderline. 8B is where this class of task starts working but exceeds the dev machine's free VRAM.",
  "Firefox is not yet supported. Chrome only for now.",
  "The extension is not on the Chrome Web Store. Build from source (instructions below).",
  "ONNX Runtime Web operator coverage on the WebGPU backend must be verified per model — silent WASM fallback is a latency regression you would otherwise not notice.",
];

// ─── Build steps from README → "Run it" (cross-referenced with CLAUDE.md) ─────

export const BUILD_STEPS: { step: string; code: string }[] = [
  { step: "Clone the repo",            code: "git clone https://github.com/letsbecool9792/skrim-hackspire" },
  { step: "Install dependencies",      code: "pnpm install" },
  { step: "Copy env and add API key",  code: "cp .env.example .env  # then paste your Groq key" },
  { step: "Start the server",          code: "pnpm dev:server" },
  { step: "Build the extension",       code: "pnpm --filter @skrim/extension dev" },
  { step: "Load unpacked in Chrome",   code: "chrome://extensions  →  Developer mode  →  Load unpacked  →  apps/extension/.output/chrome-mv3" },
];

// ─── Licences from BRIEF.md §13.3 (open-weight model licence context) ─────────

export const LICENCES: { name: string; notes: string }[] = [
  { name: "Extension & server code", notes: "ISC" },
  { name: "GLiNER PII model weights", notes: "Apache 2.0 — knowledgator/gliner-pii-edge-v1.0" },
  { name: "Qwen3-VL model weights",   notes: "Apache 2.0 — Qwen team, Alibaba Cloud" },
  { name: "BlazeFace",                notes: "Apache 2.0 — Google" },
];
