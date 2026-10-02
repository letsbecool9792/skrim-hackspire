# Skrim — working context

**Read [`BRIEF.md`](BRIEF.md) first.** It is the shared bible: the problem
statement, the scoring rubric, the privacy design, and the demo plan. Every teammate has it.
This file is the *operational* layer on top of it — what is built, what is not, what was
decided and why, so no session relitigates a settled question.

When you finish a piece of work, update the checklist in this file. When you make an
architectural decision, add it to "Locked decisions" with a one-line reason.

---

## Where the project stands

The agent loop is closed end to end (DOM graph → PII redaction → server → one action →
verify), in a chat side panel. Next milestone: **see it work in a real browser, and pick a
planning model that finishes tasks**; the NVIDIA default does not. Then perception beyond the
DOM. See "Status" and "Open findings".

---

## Locked decisions

Settled in the setup session. Do not reopen without a reason.

| Decision | Why |
|---|---|
| **TypeScript end to end** | `packages/schema` is imported by extension, server *and* eval, so a client/server contract mismatch becomes a compile error instead of the agent typing `<PII:EMAIL:1>` into a form on stage |
| **WXT** for the extension | Only framework treating Firefox as first-class; handles manifest-version and API polyfill differences from one codebase. Plasmo is Chrome-first, CRXJS means hand-wrangling Firefox at 2am |
| **Transformers.js v3** for local inference | Pipelines + tokenisers included. Drop to raw `onnxruntime-web` where there is no pipeline: the YOLO icon detector, and GLiNER (runs on `onnxruntime-web/wasm` with `@huggingface/tokenizers`, the tokenizer Transformers.js itself uses) |
| **Hono on Node 22** for the server | Thin: prompt build, schema validation, retry. No ML in the server |
| **Qwen** as the server brain | Apache 2.0, strong GUI grounding, available both hosted and via Ollama, so demo beat 8 is a base-URL swap. NVIDIA hosts no Qwen; the free hosted Qwen is `qwen/qwen3.8-27b` on Groq, and local is Qwen3-VL 4B. The NVIDIA default, Llama 3.2 11B, never finishes a task (see "Open findings") |
| **NVIDIA Build** as the dev provider | Free, no credit card, ~40 RPM, no daily token cap, OpenAI-compatible |
| **MV3 on both browsers** | Firefox MV3 event pages keep DOM access, so we get the offscreen-free path *and* "MV3 everywhere" on the slide. WXT defaults Firefox to MV2 — override it |
| **Eval runs in a real browser** via Playwright | The rubric scores precision/recall on the shipped path. Node-side numbers would measure different code than we demo |
| Ollama `qwen3-vl:4b-instruct` for air-gap | 6 GB VRAM ceiling. See "Hardware reality". The instruct build, not the plain tag, which is the much slower thinking build |
| **WS1 exposes registration hooks instead of owning perception/privacy/planning** | WS2 registers the graph provider (content script) and WS4 the planner (side panel); this prevents duplicate extractors and keeps browser execution independent. Token resolution needs no hook: the loop owns one vault per task |
| **The agent loop runs in the side panel, not the background** | Chrome terminates an extension service worker when one `fetch()` takes over 30 s, and a local model takes up to ~40 s a step. The side panel is an ordinary page with no such limit; the task, its vault and the chat live exactly as long as the panel. Closing it stops the task |

### Provider config

All four speak OpenAI-compatible chat completions, so the server holds **one adapter** with a
swapped `baseURL`. Never add a second code path.

**`nvidia`, `groq` and `ollama` are wired.** The other two are documented so we know where to
go if those stop being sufficient — do not add them to `.env.example` until they are
actually needed.

| Profile | Status | Use | Cost |
|---|---|---|---|
| `nvidia` | **wired** | dev default; fast, but its only reliable model (Llama 3.2 11B) cannot finish tasks | free, no card, ~40 RPM |
| `groq` | **wired** | hosted Qwen (`qwen/qwen3.8-27b`) | free, no card, 30 RPM, **8,000 tokens/min**, 200k tokens/day |
| `ollama` | **wired** | air-gap demo, offline dev | free, local |
| `cloudflare` | not wired | also hosts `qwen3.8-27b` | free, no card, 10k neurons/day |
| `openrouter` | not wired | last resort | **50 req/day** without credits — unusable as a daily driver |

Each teammate needs **their own** NVIDIA key. The 40 RPM is per account; teammates sharing
one key will rate-limit each other into confusion during crunch.

> **Do not use GPT / Gemini / Claude as the server brain.** Brief §4.4 requires an
> offline-deployable open-weight model. Getting this wrong breaks the privacy claim.

### Naming

The product is **Skrim**; the team is **tropical crush**.

| Where | Spelling |
|---|---|
| Anything a person reads: extension name, side panel, landing page, docs | `Skrim` |
| GitHub repo, npm scope `@skrim/*`, message strings like `skrim:offscreen:ping` | `skrim` |
| Firefox add-on id (`wxt.config.ts`) | `skrim@tropical-crush` |

If the name ever changes:
- Search with `git grep -i` for the old name, not just the npm scope. The message strings, the
  Firefox add-on id, and the regex in `scripts/check-invariants.mjs` (`@skrim\/`) do not
  contain `@name/`. If the regex is missed, a rule silently stops matching.
- Regenerate `pnpm-lock.yaml` with `pnpm install` and commit it; CI installs with
  `--frozen-lockfile`.
- Do not rewrite files with `Set-Content` on Windows PowerShell 5.1. It writes ANSI and mangles
  the non-ASCII characters in these docs.

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
│   │   │   ├── sidepanel/     The chat UI, and where the agent loop runs.
│   │   │   ├── background/    Opens the side panel. Nothing else: Chrome kills a
│   │   │   │                  service worker whose fetch() takes over 30 s.
│   │   │   ├── offscreen/     Chrome only, for model inference. Unused so far;
│   │   │   │                  see "Open findings".
│   │   │   └── content/       Answers the side panel: page graph, actions. Runs in the page.
│   │   ├── lib/
│   │   │   ├── agent/         The loop: observe → redact → plan → act → verify.
│   │   │   │                  Task vault, server client, tab link.
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

**How to see each part working today: [`docs/testing.md`](docs/testing.md).**

### Done

Foundations:
- [x] Monorepo: 7 workspace packages, all `@skrim/*`, TypeScript 6.0.3, shared strictness
- [x] **`packages/schema`, the contract.** ScreenGraph, the 8 actions, PiiToken,
      RedactionManifest, SanitizedUrl, PlanRequest/PlanResponse, outbound PII tripwire. 18 tests.
- [x] `packages/shared`: ID-only logger that throws on PII in dev, timing instrumentation
- [x] Guardrails: `pnpm verify` (120 tests), 5 invariant rules, CI on every PR, PR template,
      nested `CLAUDE.md`s
- [x] `scripts/fetch-models.mjs`: GLiNER, BlazeFace, Tesseract, MediaPipe. **68.3 MB on disk**,
      before the OmniParser detector. The built extension is 86.6 MB, including ONNX
      Runtime's 14 MB WebAssembly
- [x] WXT config: MV3 on both browsers, name Skrim, per-browser permissions, WebAssembly
      allowed by the CSP. Permissions: `<all_urls>` host access (the reach the content script
      already had, now also covering capture, injection and the server), `scripting`,
      `sidePanel`, and `offscreen` on Chrome

**The loop is closed**: goal → DOM graph → redaction against a per-task vault →
server → one action → verify → repeat, in a chat side panel. Tested in Node against
happy-dom with the real server and models (`pnpm test:agent`); **not yet tried in a real
browser**.

Built, by workstream:
- [x] **WS1 shell:** side panel chat, the agent loop (`lib/agent/`), all 8 actions, click
      verification that ignores focus, page loads followed, 25-step and 5-minute limits,
      stops for no progress and for going in circles, the tab fixed per task
- [x] **WS2 perception:** DOM extraction with visible text, field values and dropdown
      options. OCR works on demand (header button); fusion and escalation modules exist but
      are not in the loop
- [x] **WS3 privacy:** regex detectors (precision bugs fixed), form-field hints for names and
      phones, **GLiNER for names and addresses in free text** (side panel, ~5 ms a text), one
      vault per task, every page view and the goal redacted, tokens resolved only at typing
      time, tripwire on the whole request
- [x] **WS4 server:** `/plan` with one adapter and three profiles (NVIDIA, Groq, Ollama),
      compact prompt that reads the history, JSON repair, timeouts with one retry, errors
      that do not leak provider detail
- [x] **Test harnesses:** `pnpm demo:pii`, `pnpm smoke:server`, `pnpm test:agent`, and the
      OCR button. All in [`docs/testing.md`](docs/testing.md)

### What's left, in order

**1. Prove it in a real browser, and pick the model.**
- [ ] Run [`docs/testing.md`](docs/testing.md) sections 5 and 6 in Chrome, then Firefox
- [ ] Settle the model (see "Open findings"): measure Groq's Qwen 3.8 with `pnpm test:agent`

**2. Perception beyond the DOM** (WS2, WS3)
- [x] GLiNER inference for names and addresses in free text
- [ ] Face detection (the BlazeFace model is fetched; no code yet)
- [ ] OmniParser icon detector: export (`scripts/artifacts/omniparser-icon.onnx`) and inference
- [ ] Wire OCR and vision fusion into the loop, for canvas and image-only pages
- [ ] Decide where inference runs: the side panel can now host it (see "Open findings")

**3. Measure and show it** (WS5, WS6)
- [ ] Eval harness + 30–50 fixtures with ground truth (two fixture pages exist)
- [ ] Dashboard: split-screen wire view + resource panel
- [ ] Landing page
- [ ] Tradeoff curve: GLiNER quint8 vs fp16; hosted vs local model accuracy and latency

**4. Platform**
- [ ] Firefox: run the tests in [`docs/testing.md`](docs/testing.md)
- [ ] Cloudflare fallback provider (deferred; only if Groq's and NVIDIA's limits bite)

---

## Open findings — revisit later

Collected while merging the team's first PRs and while testing and closing the loop.
Each needs a decision or a follow-up. Delete an entry once it is dealt with.

**Pick the planning model. Llama 3.2 11B cannot finish a task.** Measured
with `pnpm test:agent` (the fixture goals through the real loop) and `pnpm smoke:server`:

| Model | Result |
|---|---|
| `meta/llama-3.2-11b-vision-instruct`, NVIDIA (default) | Right first action, about 1 s a step, but **never answers done**: clicked the counter 25 times while its history said "now it shows Count: 25". 0 of 5 fixture goals |
| `qwen3-vl:4b` on Ollama (the thinking build; the plain tag) | Answers done after one click on 3 of 4 click goals, but 5–40 s a step, and twice spent its whole reply thinking and returned nothing. Its thinking cannot be switched off through the OpenAI-compatible API |
| **`qwen3-vl:4b-instruct` on Ollama (local)** | **Best so far.** 4 of 5 fixture goals, including the whole form (email typed via its token, submitted, no raw PII sent); 4 of 4 smoke checks; **0.3–0.9 s a step** on the dev laptop after an ~8 s first load. Missed "Click show panel": the button then says "Hide Panel" and it kept toggling, until the loop's circle guard stopped it |
| `qwen/qwen3.8-27b` on Groq | Not measured: needs a `GROQ_API_KEY` |
| Other NVIDIA models (Gemma 4, gpt-oss-20b, GLM, DeepSeek, Nemotron) | Most never reply within 60 s on the free tier; Mistral Large and one Nemotron are "not found". Nemotron 3.5 Lightning got the stop case right but took 20–70 s |

NVIDIA hosts no Qwen at all (81 models listed). Groq's free tier has
`qwen/qwen3.8-27b` (open weights, vision-capable, no card), limited to 8,000 tokens a minute:
one step is about 700 tokens plus ~20 per element. Cloudflare Workers AI hosts it too.

So: local Qwen3-VL 4B instruct is the working planner today, and fast on this laptop.
Still to decide: whether hosted Qwen 3.8 27B on Groq beats it (measure with
`pnpm test:agent`), and whether NVIDIA stays the default provider for teammates without a
GPU, given that its only fast model cannot finish tasks.

**Not yet tried in a real browser.** The side panel, tab messaging, page-load following and
host permission were built and tested against happy-dom, not in Chrome or Firefox.
[`docs/testing.md`](docs/testing.md) sections 5 and 6 are the checklist.

**The offscreen document is probably unnecessary now.** It exists because Chrome's service
worker cannot run WebAssembly or WebGPU. The loop lives in the side panel, an ordinary page,
and both OCR and GLiNER already run there. GLiNER runs on the panel's main thread (about
5 ms a text, so a page is tens of milliseconds); move it to a Worker if a heavier model
makes the chat stutter. Dropping the offscreen document would also drop the `offscreen`
permission.

**Name detection fails open.** If GLiNER cannot load in the side panel, the task continues
with the regex layer and the chat shows a red warning that names and addresses are not being
hidden. That keeps the agent usable while the model path is unproven in a real browser.
Once it is, consider stopping the task instead.

**Not yet tried in a real browser: GLiNER.** It is tested in Node on onnxruntime-node
against the real model (`lib/pii/gliner-model.test.ts`, `pnpm test:agent`), but the
browser path (onnxruntime-web, the WASM asset Vite emits, fetching the model from the
extension) has not run in Chrome.

**URL paths can carry names.** `sanitizeUrl()` masks long digit runs, uuids, hex and anything
with `@`, but keeps word segments, so `/users/asha-rao/orders` reaches the server as is.
Consider running the PII detectors over path segments too.

**Re-run `pnpm models:fetch` after pulling.** The file set changes: WS3's PR saves GLiNER's config as
`config.json`, and Tesseract now ships only the two core files it actually loads. The script
never deletes old files, so after a Tesseract change, delete
`apps/extension/public/models/tesseract-core/` first. WS3's PR description also notes a GLiNER
model-loading limitation still under investigation.

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
`ollama pull qwen3-vl:4b-instruct` (3.3 GB). Today this is also the planner that works best
(see "Open findings"); with Ollama running, start the server with `MODEL_PROVIDER=ollama`.

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
- [`docs/ws1-workflow.md`](docs/ws1-workflow.md) — runtime flow and cross-workstream registration contracts
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
