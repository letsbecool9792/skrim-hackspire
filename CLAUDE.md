# Skrim — working context

**Read [`BRIEF.md`](BRIEF.md) first.** It is the shared bible: the problem
statement, the scoring rubric, the privacy design, and the demo plan. Every teammate has it.
This file is the *operational* layer on top of it — what is built, what is not, what was
decided and why, so no session relitigates a settled question.

When you finish a piece of work, update the checklist in this file. When you make an
architectural decision, add it to "Locked decisions" with a one-line reason.

---

## Where the project stands

Target: **DOM-only loop closing end to end first.** Everything else layers onto a
working loop; nothing works without one (brief §10).

---

## Locked decisions

Settled in the setup session. Do not reopen without a reason.

| Decision | Why |
|---|---|
| **TypeScript end to end** | `packages/schema` is imported by extension, server *and* eval, so a client/server contract mismatch becomes a compile error instead of the agent typing `<PII:EMAIL:1>` into a form on stage |
| **WXT** for the extension | Only framework treating Firefox as first-class; handles manifest-version and API polyfill differences from one codebase. Plasmo is Chrome-first, CRXJS means hand-wrangling Firefox at 2am |
| **Transformers.js v3** for local inference | Pipelines + tokenisers included. Drop to raw `onnxruntime-web` only for the YOLO icon detector, where preprocessing is a resize and there is no pipeline anyway |
| **Hono on Node 22** for the server | Thin: prompt build, schema validation, retry. No ML in the server |
| **Qwen3-VL** as the server brain | Apache 2.0, strong GUI grounding, available both hosted and via Ollama, so demo beat 8 is a base-URL swap |
| **NVIDIA Build** as the dev provider | Free, no credit card, ~40 RPM, no daily token cap, OpenAI-compatible |
| **MV3 on both browsers** | Firefox MV3 event pages keep DOM access, so we get the offscreen-free path *and* "MV3 everywhere" on the slide. WXT defaults Firefox to MV2 — override it |
| **Eval runs in a real browser** via Playwright | The rubric scores precision/recall on the shipped path. Node-side numbers would measure different code than we demo |
| Ollama `qwen3-vl:4b` for air-gap | 6 GB VRAM ceiling. See "Hardware reality" |

### Provider config

All four speak OpenAI-compatible chat completions, so the server holds **one adapter** with a
swapped `baseURL`. Never add a second code path.

**Only `nvidia` and `ollama` are wired right now.** We are proceeding on the assumption that
NVIDIA's free tier is sufficient. The other two are documented so we know where to go if it
stops being sufficient — do not add them to `.env.example` until they are actually needed.

| Profile | Status | Use | Cost |
|---|---|---|---|
| `nvidia` | **wired** | dev default | free, no card, ~40 RPM |
| `ollama` | **wired** | air-gap demo, offline dev | free, local |
| `cloudflare` | not wired | if NVIDIA rate-limits become a problem | free, no card, 10k neurons/day |
| `openrouter` | not wired | last resort | **50 req/day** without credits — unusable as a daily driver |

Each teammate needs **their own** NVIDIA key. The 40 RPM is per account; teammates sharing
one key will rate-limit each other into confusion during crunch.

> **Do not use GPT / Gemini / Claude as the server brain.** Brief §4.4 requires an
> offline-deployable open-weight model. Getting this wrong breaks the privacy claim.

### Naming

The product is **Skrim**; the team is **tropical crush**.

| Where | Spelling |
|---|---|
| Anything a person reads: extension name, popup, landing page, docs | `Skrim` |
| GitHub repo, npm scope `@skrim/*` | `skrim` |
| Firefox add-on id (`wxt.config.ts`) | `skrim@tropical-crush` |

WXT derives the extension's manifest `name` from
`package.json`, so Chrome currently lists it as **"@skrim/extension"**. Set an explicit
`name` in `wxt.config.ts` — a judge sees that string on `chrome://extensions`.

---

## Directory map

Every folder, and what belongs in it.

```
skrim/
├── BRIEF.md               THE BIBLE. Problem statement, rubric, privacy design, demo plan.
├── CLAUDE.md              This file. Status, decisions, delegation.
├── pnpm-workspace.yaml    Workspace members + pnpm build-script approvals.
├── package.json           Root scripts (models:fetch, dev:*, build, typecheck).
├── .env.example           Committed template. Copy to .env and fill in.
├── .env                   GITIGNORED. ONE file for the whole monorepo, at the
│                          ROOT — not in apps/server/. The server loads it with
│                          --env-file-if-exists=../../.env.
│
├── apps/
│   ├── extension/         WXT. The product. Chrome MV3 + Firefox MV3.
│   │   ├── entrypoints/
│   │   │   ├── background/    Orchestrator: agent loop, task state, server calls.
│   │   │   │                  Chrome = service worker, so NO inference here.
│   │   │   ├── offscreen/     Chrome only. ALL model inference lives here —
│   │   │   │                  WebGPU and WASM are unavailable in a service worker.
│   │   │   ├── content/       DOM extraction + action execution. Runs in the page.
│   │   │   ├── sidepanel/     User-facing task UI.
│   │   │   └── popup/         Quick controls, permissions surface.
│   │   ├── lib/
│   │   │   ├── dom/           Element graph: roles, labels, bboxes, a11y tree walk.
│   │   │   ├── vision/        Model loading, WebGPU/WASM device selection.
│   │   │   ├── pii/           Regex bank, NER, face detect, fusion, confidence.
│   │   │   ├── vault/         Token vault. IN-MEMORY ONLY. Never persist.
│   │   │   ├── actions/       The 8 verbs + post-action state verification.
│   │   │   └── capture/       Screenshot, MutationObserver, frame diff gating.
│   │   └── public/models/     Model weights. GITIGNORED — `pnpm models:fetch` fills it.
│   │
│   ├── server/            Hono + Node 22. Stateless. No user identity, no session.
│   │   ├── providers/         nvidia | cloudflare | ollama | openrouter adapters.
│   │   ├── prompts/           System prompts, few-shot examples.
│   │   └── planner/           screen graph -> prompt -> action, with JSON repair + retry.
│   │
│   ├── dashboard/         Vite + React. The demo instrument, projected on stage:
│   │                      split-screen wire view + live resource panel. Carries 40%
│   │                      of the rubric by making the invisible visible (brief §9).
│   │
│   └── web/               Vite + React. Public landing page. Static, deploys to Vercel.
│                          SEPARATE from dashboard on purpose: a broken landing-page
│                          build must have zero ability to take the demo down.
│
├── packages/
│   ├── schema/            @skrim/schema — Zod: ScreenGraph, Action, PiiToken,
│   │                      RedactionManifest. THE load-bearing package. Imported by
│   │                      extension, server and eval so the contract cannot drift.
│   ├── shared/            @skrim/shared — ID-only logging, timing, config resolution.
│   └── eval/              @skrim/eval — the harness. Detection recall/precision,
│                          redaction IoU, over-redaction rate. Drives the REAL extension
│                          in Chromium via Playwright. 40% of the rubric depends on this.
│
├── fixtures/
│   ├── pages/             30–50 synthetic pages with PII in known places.
│   └── ground-truth/      Annotations the harness scores against.
│
├── scripts/               Build-time tooling. Nothing here runs at extension runtime.
│   ├── fetch-models.mjs   Populates public/models/. Node only, no deps, no Python.
│   ├── artifacts/         Committed ONNX we export ourselves (see gitignore note).
│   ├── requirements.txt   Python pins for the ONNX export venv.
│   └── .venv/             Python venv. ONLY workstream 3 needs this.
│
└── docs/
    └── decisions/         ADRs. Feed these straight into the PPT — the tradeoff
                           slide (brief §9.6) is easier if we wrote reasons down.
```

---

## Status

### Done

- [x] Monorepo scaffolded: 7 workspace packages, all `@skrim/*`, all private
- [x] `pnpm-workspace.yaml` with build-script approvals resolved
- [x] `.gitignore` covering weights, `.env`, and the `scripts/artifacts/` exception
- [x] TypeScript aligned to 6.0.3 workspace-wide; `@types/node` to `^22` (matches runtime)
- [x] Python venv installed correctly and frozen (`scripts/requirements.txt`, 54 pins)
- [x] `scripts/fetch-models.mjs` — fetches GLiNER PII, BlazeFace, tessdata; vendors
      MediaPipe + Tesseract WASM. **63.6 MB on disk**, ~76 MB once the detector lands
- [x] Ollama 0.33.2 + `qwen3-vl:4b` pulled locally
- [x] NVIDIA Build account + API key

- [x] `turbo.json` + root `tsconfig.base.json` (shared strictness; module resolution
      stays per-app because they genuinely differ)
- [x] **`packages/schema` — the contract.** ScreenGraph, ScreenElement, the 8 actions,
      PiiToken, RedactionManifest, SanitizedUrl, PlanRequest/PlanResponse. 18 tests.
- [x] `packages/shared` — ID-only logger that throws on PII in dev, timing instrumentation
- [x] Guardrails: `pnpm verify`, `scripts/check-invariants.mjs`, CI, PR template
- [x] Nested `CLAUDE.md` in every work area (agents read these automatically)
- [x] WXT config: MV3 on both browsers, explicit manifest name, permissions documented

### Not done

- [ ] **Vertical slice: DOM-only graph → regex PII → server → one action → verify.**
      *Everything below is blocked on this.*
- [ ] Server provider adapter + prompt + JSON repair
- [ ] Token vault + referential redaction
- [ ] OmniParser icon detector ONNX export (`scripts/artifacts/omniparser-icon.onnx`)
- [ ] Vision fusion into the screen graph
- [ ] Eval harness + 30–50 fixtures with ground truth
- [ ] Dashboard split-screen + resource panel
- [ ] Landing page
- [ ] Firefox port + MV3 override in `wxt.config.ts`
- [ ] Cloudflare account (deferred — NVIDIA is sufficient for now)
- [ ] Measure quint8 vs fp16 GLiNER for the tradeoff curve

---

## Setup — fresh clone

```powershell
npm install -g pnpm      # NOT corepack: it writes to Program Files and needs admin
git clone <repo> && cd skrim
pnpm install
pnpm models:fetch        # weights are gitignored; extension has nothing to load without this
cp .env.example .env     # then add your own NVIDIA key
```

**`.env` lives at the repo root**, not in `apps/server/`. One file for the whole monorepo.
`NVIDIA_API_KEY` is the only value you must fill in — everything else has a working default.

**Only if you own the model pipeline (workstream 3):**

```powershell
cd scripts
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

> Invoke the venv python by **full path**, always. Never bare `pip install`. Shell
> activation silently failing is how the setup session nuked a global Python install.

**Only if you own the air-gap path:** `winget install Ollama.Ollama` then
`ollama pull qwen3-vl:4b` (3.3 GB). Most of the team never needs this.

---

## Guardrails — read before delegating

The team works through agents and will not read most of this code. So the rules are enforced
mechanically rather than documented and hoped for.

**`pnpm verify`** — invariants, then typecheck across all 7 packages, then tests. Runs in CI
on every PR. This is the gate.

**`pnpm check`** (`scripts/check-invariants.mjs`) — five rules that cost us the *project*
rather than a bug, each failing with an explanation of why rather than a rule number:

| Rule | Catches |
|---|---|
| `no-persistence` | `localStorage` / `chrome.storage` / `IndexedDB` in the extension |
| `no-raw-console` | `console.*` instead of the PII-scanning logger |
| `no-closed-models` | An Anthropic / Google / Mistral SDK import — it breaks the open-weight requirement |
| `schema-imports-nothing` | The contract taking a dependency on an implementation |
| `no-telemetry` | Anything analytics-shaped in the extension |

It is a text scan, not an ESLint plugin, on purpose: it cannot be silenced with an inline
comment and it survives someone restructuring the lint setup.

**Runtime tripwires.** `assertOutboundSafe()` throws if raw PII reaches a request body. The
shared `log` throws in dev if a log line contains raw PII. Both are narrow enough to never
false-positive — they only match emails, Luhn-valid cards, PAN, and international phone
numbers.

**Nested `CLAUDE.md` files.** Every work area has one. A teammate's agent reads it
automatically when working in that directory, so the rules live where the work happens
instead of in a document nobody opens. They are also just good reading — see the links below.

---

## Delegation

A **workstream** is one person's slice of the project: a set of directories they own and a
scored outcome they are responsible for. Six of them, from brief §10. They are deliberately
carved so two people rarely edit the same file.

Everyone should read [`BRIEF.md`](BRIEF.md), this file, and
[`packages/schema/CLAUDE.md`](packages/schema/CLAUDE.md) — the contract is shared by all six.

### 1 · Extension shell, permissions, capture, action execution
Needs: base setup.
- [`apps/extension/CLAUDE.md`](apps/extension/CLAUDE.md) — overall extension rules
- [`apps/extension/lib/capture/CLAUDE.md`](apps/extension/lib/capture/CLAUDE.md) — screenshots, change detection
- [`apps/extension/lib/actions/CLAUDE.md`](apps/extension/lib/actions/CLAUDE.md) — executing the 8 verbs
- `apps/extension/wxt.config.ts` — manifest and permissions

### 2 · Screen graph — DOM extraction and vision fusion
Needs: base setup.
- [`apps/extension/lib/dom/CLAUDE.md`](apps/extension/lib/dom/CLAUDE.md) — the element graph
- [`apps/extension/lib/vision/CLAUDE.md`](apps/extension/lib/vision/CLAUDE.md) — local model inference

### 3 · PII detection, redaction, token vault
Needs: + Python venv (only for the ONNX export).
- [`apps/extension/lib/pii/CLAUDE.md`](apps/extension/lib/pii/CLAUDE.md) — detection and redaction
- [`apps/extension/lib/vault/CLAUDE.md`](apps/extension/lib/vault/CLAUDE.md) — the token vault
- `scripts/` — model export and fetch

### 4 · Server agent, action schema, providers
Needs: + own NVIDIA key.
- [`apps/server/CLAUDE.md`](apps/server/CLAUDE.md) — the planning brain

### 5 · Eval harness and metrics
Needs: + Playwright.
- [`packages/eval/CLAUDE.md`](packages/eval/CLAUDE.md) — what we measure and why
- `fixtures/` — the synthetic pages and ground truth

### 6 · Dashboard split-screen and resource panel
Needs: base setup.
- [`apps/dashboard/CLAUDE.md`](apps/dashboard/CLAUDE.md) — the demo instrument

Workstream 6 is **not decoration** — it is how 40% of the rubric becomes visible to a judge.
Workstream 5 is a deliverable, not tooling: two criteria worth 40% are precision
measurements we cannot claim without numbers.

---

## Hardware reality

Dev machine: RTX 4050 Laptop, **6141 MiB VRAM**, 15.6 GB RAM, i5-13420H, Chrome 152,
Firefox 149, Node 22.19.

Working VRAM after Windows + Chrome is ~4.5 GB:

| Model | Q4 + vision tower + KV | Verdict |
|---|---|---|
| Qwen3-VL-2B | ~2.7 GB | fits; likely too weak for reliable multi-step planning |
| Qwen3-VL-4B | ~4.3–4.5 GB | fits, near-zero headroom — **our ceiling** |
| Qwen3-VL-8B | ~7 GB | **will not fit**, spills to CPU |

**Do not treat this as a limitation to hide.** It is the tradeoff curve the brief
plans for (§9.6): ship three measured configurations — hosted 32B, hosted 8B, local 4B
— with real accuracy and latency for each, then say which we would ship and why. Nobody else
will have that slide.

Also: the local Ollama model and the browser's own WebGPU models contend for the same 6 GB.
Run the air-gap beat with the extension's WebGPU path idle, or accept it being slow.

---

## Gotchas

- **No inference in the Chrome service worker.** Transformers.js cannot reach WebGPU *or*
  WASM there ([#787](https://github.com/huggingface/transformers.js/issues/787)). Chrome
  needs `chrome.offscreen`; Firefox event pages have DOM access and need nothing.
- **MV3 CSP blocks CDN WASM.** MediaPipe and Tesseract runtimes must be served from inside
  the bundle — that is what the vendor step in `fetch-models.mjs` is for.
- **`captureVisibleTab` is rate-limited** to ~2/sec with no way to raise it. Drive the
  pipeline off MutationObserver + frame diff. Most of the latency win comes from *not
  running the model* (brief §8).
- **No site-specific selectors, ever.** Skrim has to work on pages we have never seen
  (brief §4.6). Everything routes through the generic element graph.
- **Never log values.** IDs and counts only. A stray `console.log(screenGraph)` writes PII
  into a log and breaks the entire claim (brief §7).
- **`optimum[exporters]` is dead** in optimum 2.x — it is `optimum[onnx]`.
- **Open weights ≠ free inference.** The weights are Apache 2.0 and free forever; hosted
  providers charge for GPU time. That is the whole reason the provider list exists.
- Free tiers generally train on your prompts. For us that is a **talking point, not a
  hole**: even if NVIDIA trains on every request, there is nothing identifying in them.
