/**
 * src/content.ts — every number and piece of copy on the landing page lives here.
 * Updating a metric is a one-line change. Numbers come from README.md ("The numbers")
 * only; nothing is invented.
 */

export const SITE = {
  title: "Skrim",
  tagline: "An AI agent that does tasks on your behalf — and never shows the server your data.",
  githubUrl: "https://github.com/letsbecool9792/skrim-hackspire",
  team: "Chipotle",
  /**
   * The newest release's zip. GitHub redirects "latest/download/<name>" to the
   * newest published release, and the release workflow always names the
   * asset skrim-chrome.zip, so this link never needs editing. Set it to ""
   * to fall back to the releases page.
   */
  downloadUrl: "https://github.com/letsbecool9792/skrim-hackspire/releases/latest/download/skrim-chrome.zip",
  /** The newest release's Firefox build: unsigned, so it loads as a temporary add-on. */
  firefoxUrl: "https://github.com/letsbecool9792/skrim-hackspire/releases/latest/download/skrim-firefox.zip",
  /** How Skrim runs on an Android phone, and the routes compared. */
  phonesUrl: "https://github.com/letsbecool9792/skrim-hackspire/blob/main/docs/phones.md",
  /** The hosted dashboard: what the server receives, fed by the extension in the same browser. */
  dashboardUrl: "https://skrim-dashboard.vercel.app",
  /** Link to the GitHub Releases page (always shown). */
  releasesUrl: "https://github.com/letsbecool9792/skrim-hackspire/releases",
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
      "The extension walks the live DOM — roles, labels, values — and reads text that exists only as pixels (a canvas, an image, an embedded frame) with on-device OCR.",
  },
  {
    icon: "ScanText",
    title: "Find personal data",
    detail:
      "A local NER model spots names and addresses in text. Rules catch structured formats: emails, phone numbers, cards, PAN, Aadhaar, account numbers. All of it runs on your device.",
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
      "The scrubbed description goes to an open-weight model (Qwen 3.8 27B by default). It returns one action: \u201cclick e12.\u201d The server sees placeholders, not people.",
  },
  {
    icon: "MousePointerClick",
    title: "Act on the device",
    detail:
      "The extension carries out the action locally. When the plan says \u2018type <PII:EMAIL:1>\u2019, it looks up the real address and types it \u2014 privately, at that moment only.",
  },
];

// ─── Numbers from README.md "The numbers" ──────────────────────────────────────
// Only values stated there are included. Nothing is invented.

export interface Metric {
  value: string;
  label: string;
  detail: string;
}

export const METRICS: Metric[] = [
  {
    value: "99.0%",
    label: "Personal data found",
    detail: "97 of 98 private values on 37 annotated pages, hidden everywhere they appeared.",
  },
  {
    value: "87.5%",
    label: "Precision",
    detail: "Of everything Skrim hid, the share that really was private.",
  },
  {
    value: "1.9%",
    label: "Ordinary text hidden",
    detail: "The cost of hiding: non-private characters lost to the planner by mistake.",
  },
  {
    value: "42 of 42",
    label: "Test runs finished",
    detail: "14 goals, 3 runs each, by the default planner: Qwen 3.8 27B on Groq's free tier.",
  },
  {
    value: "~200 ms",
    label: "To find names",
    detail: "Median per page view, on the device, over six runs. Reading the page takes 5 ms; redacting under 1 ms.",
  },
  {
    value: "87 MB",
    label: "The whole extension",
    detail: "Every model included. Nothing is downloaded at run time, and nothing is stored.",
  },
];

export interface FootprintRow {
  asset: string;
  size: string;
}

export const FOOTPRINT_ROWS: FootprintRow[] = [
  { asset: "GLiNER PII edge (names, addresses), uint8 ONNX + tokenizer", size: "49.4 MB" },
  { asset: "ONNX Runtime WebAssembly (runs GLiNER)",                   size: "14 MB"   },
  { asset: "MediaPipe WebAssembly + BlazeFace (faces)",                size: "12.3 MB" },
  { asset: "Tesseract core + English data (OCR)",                      size: "9.9 MB"  },
];

// ─── Tradeoffs (docs/tradeoffs.md) ────────────────────────────────────────────
// Each table: a header row, then rows; the row marked shipped is highlighted.

export interface TradeoffTable {
  title: string;
  head: string[];
  rows: { cells: string[]; shipped?: boolean }[];
  note: string;
}

export const TRADEOFFS: TradeoffTable[] = [
  {
    title: "The planner: tasks passed against speed",
    head: ["Planner", "Runs on", "Tasks passed", "Step, median"],
    rows: [
      { cells: ["Qwen 3.8 27B (Groq)", "hosted", "42 of 42", "0.5 s"], shipped: true },
      { cells: ["gpt-oss-120b (Groq)", "hosted", "42 of 42", "1.0 s"] },
      { cells: ["Nemotron 3 Super 120B (NVIDIA)", "hosted", "37 of 42", "2.6 s"] },
      { cells: ["Qwen3-VL 4B, 4k context", "this laptop", "37 of 42", "0.6 s"] },
      { cells: ["Qwen3-VL 4B, 16k context", "this laptop, a third on CPU", "same tasks", "1.7 s"] },
    ],
    note: "The model that does the task well does not fit on a laptop's 6 GB GPU, let alone a phone. So Skrim keeps it on a server and makes what reaches it safe.",
  },
  {
    title: "The name model: size and format",
    head: ["Model file", "Size", "Found", "Precision", "Median"],
    rows: [
      { cells: ["8-bit (quint8)", "46 MB", "99.0%", "87.5%", "238 ms"], shipped: true },
      { cells: ["Full precision (fp32)", "181 MB", "99.0%", "82.5%", "356 ms"] },
      { cells: ["Half precision (fp16)", "91 MB", "66.3%", "97.1%", "506 ms"] },
    ],
    note: "The 8-bit model loses nothing measurable against full precision, at a quarter of the size and a third faster.",
  },
  {
    title: "The name model: how sure it must be",
    head: ["Cutoff", "Found", "Precision", "Names missed"],
    rows: [
      { cells: ["0.4", "95.9%", "73.7%", "1 (3 addresses split)"] },
      { cells: ["0.5", "96.9%", "81.3%", "1"] },
      { cells: ["0.6", "99.0%", "87.5%", "1"], shipped: true },
      { cells: ["0.7", "92.9%", "92.9%", "5"] },
      { cells: ["0.8", "75.5%", "93.8%", "20"] },
    ],
    note: "Above 0.6, names get through. Below it, addresses break into pieces that leave parts readable, and twice as much ordinary text is hidden.",
  },
];

// ─── Known limits (README.md "Known limits") ─────────────────────────────────

export const KNOWN_LIMITS: string[] = [
  "English only. Names, labels and cue words (\"Welcome back\") are English.",
  "One miss on our pages: the name model skips \"Meera Iyer\" at the head of a list of names. Street and place names are sometimes hidden as if private.",
  "A private name on a page that does not look personal stays readable, unless it is in your goal, follows a cue like \"Welcome back\", is in an email address on the page, or sits beside a face.",
  "The planner sees text only. A task that needs to look at a picture (a chart, a CAPTCHA) is out of reach; text inside images is read by OCR.",
  "Free tiers are the bottleneck: Groq allows about 4–5 steps a minute, and real pages cost more than our test pages.",
  "Our test pages are our own, written by the same hands as the fixes. Expect lower numbers on sites we did not write.",
  "Chrome and Firefox, on a computer and on Android. Not on the Chrome Web Store or addons.mozilla.org yet. On a phone, text inside images is not read while the Skrim tab is in front.",
];

// ─── Build steps from README.md "Run it" ───────────────────────────────────────

export const BUILD_STEPS: { step: string; code: string }[] = [
  { step: "Clone the repo",               code: "git clone https://github.com/letsbecool9792/skrim-hackspire" },
  { step: "Install dependencies",         code: "pnpm install" },
  { step: "Fetch the on-device models",   code: "pnpm models:fetch --skip-icon" },
  { step: "Copy env and add a Groq key",  code: "cp .env.example .env  # then put your GROQ_API_KEY in it" },
  { step: "Start the planning server",    code: "pnpm dev:server" },
  { step: "Build the extension",          code: "pnpm --filter @skrim/extension build" },
  { step: "Load it in Chrome",            code: "chrome://extensions  →  Developer mode  →  Load unpacked  →  apps/extension/.output/chrome-mv3" },
];

// ─── Licences from BRIEF.md §13.3 (open-weight model licence context) ─────────

export const LICENCES: { name: string; notes: string }[] = [
  { name: "Skrim's code", notes: "ISC" },
  { name: "GLiNER PII model weights", notes: "Apache 2.0 — knowledgator/gliner-pii-edge-v1.0" },
  { name: "Qwen3-VL model weights",   notes: "Apache 2.0 — Qwen team, Alibaba Cloud" },
  { name: "BlazeFace",                notes: "Apache 2.0 — Google" },
];
