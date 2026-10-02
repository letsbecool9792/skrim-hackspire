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
verify), in a chat side panel, and works in Chrome on the fixture pages. Both
Qwen planners finish all six fixture goals. The eval harness scores detection on 21
annotated fixtures. The default planner is Groq's Qwen 3.8 27B. Next: **retest in Chrome
and run the eval there**, then perception beyond the DOM, starting with what the eval
misses. See "Status" and "Open findings".

---

## Locked decisions

Settled in the setup session. Do not reopen without a reason.

| Decision | Why |
|---|---|
| **TypeScript end to end** | `packages/schema` is imported by extension, server *and* eval, so a client/server contract mismatch becomes a compile error instead of the agent typing `<PII:EMAIL:1>` into a form on stage |
| **WXT** for the extension | Only framework treating Firefox as first-class; handles manifest-version and API polyfill differences from one codebase. Plasmo is Chrome-first, CRXJS means hand-wrangling Firefox at 2am |
| **Transformers.js v3** for local inference | Pipelines + tokenisers included. Drop to raw `onnxruntime-web` where there is no pipeline: the YOLO icon detector, and GLiNER (runs on `onnxruntime-web/wasm` with `@huggingface/tokenizers`, the tokenizer Transformers.js itself uses) |
| **Hono on Node 22** for the server | Thin: prompt build, schema validation, retry. No ML in the server |
| **Qwen** as the server brain | Apache 2.0, strong GUI grounding, available both hosted and via Ollama, so demo beat 8 is a base-URL swap. NVIDIA hosts no Qwen; the free hosted Qwen is `qwen/qwen3.8-27b` on Groq, and local is Qwen3-VL 4B. NVIDIA's Llama 3.2 11B never finishes a task ([`docs/provider-study.md`](docs/provider-study.md)) |
| **Groq** (`qwen/qwen3.8-27b`) as the default provider | Free, no credit card, OpenAI-compatible. Did all 42 runs of the provider study, fastest and in the fewest steps. Its cost is the free tier: 4–5 steps a minute (the server waits these out) and a daily cap; when the day runs out, switch to Ollama. NVIDIA stays wired: no daily cap |
| **MV3 on both browsers** | Firefox MV3 event pages keep DOM access, so we get the offscreen-free path *and* "MV3 everywhere" on the slide. WXT defaults Firefox to MV2 — override it |
| **Eval runs in a real browser** via Playwright | The rubric scores precision/recall on the shipped path. Node-side numbers would measure different code than we demo |
| Ollama `qwen3-vl:4b-instruct` for air-gap | 6 GB VRAM ceiling. See "Hardware reality". The instruct build, not the plain tag, which is the much slower thinking build |
| **WS1 exposes registration hooks instead of owning perception/privacy/planning** | WS2 registers the graph provider (content script) and WS4 the planner (side panel); this prevents duplicate extractors and keeps browser execution independent. Token resolution needs no hook: the loop owns one vault per task |
| **The agent loop runs in the side panel, not the background** | Chrome terminates an extension service worker when one `fetch()` takes over 30 s, and a local model takes up to ~40 s a step. The side panel is an ordinary page with no such limit; the task, its vault and the chat live exactly as long as the panel. Closing it stops the task |

### Provider config

All four speak OpenAI-compatible chat completions, so the server holds **one adapter** with a
swapped `baseURL`. Never add a second code path.

**`groq`, `ollama` and `nvidia` are wired; `groq` is the default.** The other two are
documented so we know where to go if those stop being sufficient — do not add them to
`.env.example` until they are actually needed.

| Profile | Status | Use | Cost |
|---|---|---|---|
| `groq` | **wired, default** | hosted Qwen (`qwen/qwen3.8-27b`), 42 of 42 in the provider study | free, no card, per model: 1,000 requests/day, 8,000 tokens/min (7,000 input; about 4–5 steps); the server waits out short 429s |
| `ollama` | **wired** | air-gap demo, offline dev, and the fallback when Groq's day runs out | free, local |
| `nvidia` | **wired** | no daily cap. Its default model, Llama 3.2 11B, did 0 of 42 in the provider study; set `NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b` (37 of 42) to use it | free, no card, ~40 RPM, no daily cap |
| `cloudflare` | not wired | also hosts `qwen3.8-27b` | free, no card, 10k neurons/day |
| `openrouter` | not wired | last resort | **50 req/day** without credits — unusable as a daily driver |

Each teammate needs **their own** Groq key (and NVIDIA key, if they use it). The limits are
per account; teammates sharing one key will rate-limit each other into confusion during
crunch, and a study run can use up the day's quota before a demo.

> **Do not use GPT / Gemini / Claude as the server brain.** Brief §4.4 requires an
> offline-deployable open-weight model. Getting this wrong breaks the privacy claim.

### Naming

The product is **Skrim**; the team is **tropical crush**.

| Where | Spelling |
|---|---|
| Anything a person reads: extension name, side panel, landing page, docs | `Skrim` |
| GitHub repo, npm scope `@skrim/*`, `window.__skrimEval` in eval builds | `skrim` |
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
      RedactionManifest, SanitizedUrl, PlanRequest/PlanResponse, outbound PII tripwire. 20 tests.
- [x] `packages/shared`: ID-only logger that throws on PII in dev, timing instrumentation
- [x] Guardrails: `pnpm verify` (166 tests), 5 invariant rules, CI on every PR, PR template,
      nested `CLAUDE.md`s
- [x] `scripts/fetch-models.mjs`: GLiNER, BlazeFace, Tesseract, MediaPipe. **68.3 MB on disk**,
      before the OmniParser detector. The built extension is 86.6 MB, including ONNX
      Runtime's 14 MB WebAssembly
- [x] WXT config: MV3 on both browsers, name Skrim, per-browser permissions, WebAssembly
      allowed by the CSP. Permissions: `<all_urls>` host access (the reach the content script
      already had, now also covering capture, injection and the server), `scripting`, and
      `sidePanel` on Chrome. `offscreen` was dropped

**The loop is closed**: goal → DOM graph → redaction against a per-task vault →
server → one action → verify → repeat, in a chat side panel. Tested in Node against
happy-dom with the real server and models (`pnpm test:agent`), and **in Chrome**:
the click and form fixtures, GLiNER, OCR and capture all work there. Firefox is untried.

Built, by workstream:
- [x] **WS1 shell:** side panel chat, the agent loop (`lib/agent/`), all 8 actions, click
      verification that ignores focus, page loads followed (including a click whose page
      unloads before it can answer), 25-step and 5-minute limits, stops for no progress
      and for going in circles, the tab fixed per task
- [x] **WS2 perception:** DOM extraction with visible text, field values, dropdown options,
      and names from images and icons (alt text, svg titles); only what is in and near the
      view, at most 120 elements, with a count of the rest. **Text in pixels** (a canvas, a
      big image, a cross-origin iframe) is read with on-device OCR in the loop and redacted
      like DOM text (`lib/vision/read-pixels.ts`; not tried in a browser yet). The fusion
      module waits for the icon detector
- [x] **WS3 privacy:** regex detectors (birth dates and labels from the element before
      included; ISBNs are not cards), form-field hints, **GLiNER for names and addresses in
      free text** (side panel, ~12 ms a text), and **a rule for which names are private**
      (`lib/agent/private-names.ts`): public names stay readable. One vault per task (one
      token per value however it is written), every page view and the goal redacted, tokens
      resolved only at typing time, tripwire on the whole request
- [x] **WS5 eval:** `packages/eval` scores recall, precision, span IoU, near-misses and
      over-redaction on 21 annotated fixtures, through the same `readPage()` the agent uses.
      `pnpm eval` drives the real extension in Chromium (**not run yet**: needs Playwright's
      Chromium, [`docs/testing.md`](docs/testing.md) section 6); `pnpm eval:node` is a quick
      check in Node
- [x] **WS4 server:** `/plan` with one adapter and three profiles (NVIDIA, Groq, Ollama),
      compact prompt that reads the history, JSON repair, timeouts with one retry, errors
      that do not leak provider detail. The history tells the planner what each action
      changed on screen ("appeared: ...")
- [x] **Test harnesses:** `pnpm demo:pii`, `pnpm smoke:server`, `pnpm test:agent`,
      `pnpm eval:node`. All in [`docs/testing.md`](docs/testing.md)

### Waiting on Suparno (manual)

Things only a person at the browser, or the project owner, can do. Keep this list current:
add to it whenever a change needs a manual check, and tick items off when reported.

- [ ] **Retest in Chrome** what changed since the first Chrome test (none of it tried in a browser
      yet), reloading Skrim on `chrome://extensions` first:
  - `Click show panel`, `Open the details section` and `Go to section 2` on the click
    fixture take one click each, then ✓ Done
  - the ⓘ button under a result shows what stayed on the device; the input box has no
    scroll arrows
  - Wikipedia, `Search for Alan Turing`: "Sent to the server as: search for name 1", and
    the first step comes quickly; "Alan Turing" is hidden on the pages too, other names
    are not; a link that opens a new page continues the task
  - the form fixture still hides the name, email, phone and address (ⓘ)
  - `fixtures/pages/canvas-card.html`, `What is the PAN on my ID?`: the answer shows an
    "ID number 1" pill (read from the canvas by OCR, then hidden)
  - `fixtures/pages/checkout.html`, `Change the coupon code to SAVE20`: no order is placed;
    if the model tries, its step says "not clicked: it would place an order or pay"
  - with the default provider (Groq), several tasks in a row: steps slow down to ~14 s when
    the minute's tokens run out, but no task fails with "rate limit reached"
- [ ] **Groq is the default now**: with no `$env:MODEL_PROVIDER` set, `pnpm dev:server` and
      the side panel's header show `qwen/qwen3.8-27b`. If they show another model, the root
      `.env` still sets `MODEL_PROVIDER` (it overrides the default): change it to `groq` or
      delete the line. Needs `GROQ_API_KEY` in `.env`
- [ ] **Run the eval in Chromium** once: `pnpm --filter @skrim/eval exec playwright install
      chromium` (~150 MB, once), then `pnpm eval`; compare with `pnpm eval:node`
- [ ] **Export the OmniParser icon detector** (Python venv, `scripts/`): the one-time setup in
      "Setup — fresh clone"
- [ ] **Firefox**: [`docs/testing.md`](docs/testing.md) section 5 (parked for now)
- [x] **Pick the default provider**: Groq's Qwen 3.8 27B, as the study
      ([`docs/provider-study.md`](docs/provider-study.md)) recommends (decided 2026-10-02)

### What's left, in order

**1. Prove it in a real browser, and pick the model.**
- [x] Run [`docs/testing.md`](docs/testing.md) section 5 in Chrome (its bugs fixed)
- [x] Measure Groq's Qwen 3.8 with `pnpm test:agent`: 6 of 6
- [x] A proper provider study: task success against free-tier limits, per model
      ([`docs/provider-study.md`](docs/provider-study.md), `pnpm study`)
- [x] Make its winner, Groq's Qwen 3.8 27B, the default planner

**2. Perception beyond the DOM** (WS2, WS3)
- [x] GLiNER inference for names and addresses in free text
- [x] OCR in the loop, for text in a canvas, an image or a cross-origin iframe
- [x] Where inference runs: the side panel (the offscreen document is gone)
- [ ] Face detection (the BlazeFace model is fetched; no code yet). It matters once a
      screenshot goes to the server; today the planner gets text only
- [ ] OmniParser icon detector: export (`scripts/artifacts/omniparser-icon.onnx`) and
      inference, then vision fusion for icon-only buttons

**3. Measure and show it** (WS5, WS6)
- [x] Eval harness, and 21 fixtures with ground truth
- [ ] More fixtures, to 30–50: a face in a photo, pages in Hindi, long pages, real-site
      captures (see "Open findings": ours were written by the same hand as the fixes)
- [ ] Dashboard: split-screen wire view + resource panel
- [ ] Landing page
- [ ] Tradeoff curve: GLiNER quint8 vs fp16; hosted vs local model accuracy and latency

**4. Platform**
- [ ] Firefox: run the tests in [`docs/testing.md`](docs/testing.md) (parked for now)
- [ ] Cloudflare fallback provider (deferred; only if Groq's and NVIDIA's limits bite)

---

## Open findings — revisit later

Collected while merging the team's first PRs, while testing and closing the loop, and from
the first Chrome test. Each needs a decision or a follow-up. Delete an entry once it is
dealt with.

**Groq is the default; moving off it when its day runs out is by hand.** Groq's
`qwen/qwen3.8-27b` did all 42 runs of the provider study
([`docs/provider-study.md`](docs/provider-study.md)), twice as fast as the runner-up. Its
free tier is the cost: 4–5 steps a minute, which the server waits out (back-to-back steps
take ~14 s), and a daily cap that two study runs in a row used up. The server does not
switch by itself: when the day runs out, restart it with `MODEL_PROVIDER=ollama` (local
Qwen3-VL 4B, 37 of 42 with the commit guard, which stops it placing orders nobody asked
for). Still open:
- Moving to the next model automatically when one says "come back in minutes". Each step
  is planned from scratch, so a task could carry on with another model; not tried.
- Groq's `openai/gpt-oss-120b` also did 42 of 42, on its own quota, which would double the
  day. Whether OpenAI's open-weight model is acceptable on the slides is a team call.
- NVIDIA's default model is still Llama 3.2 11B, which did 0 of 42 (it never says done).
  Anyone using NVIDIA should set Nemotron 3 Super (37 of 42).
- Cloudflare Workers AI hosts Qwen 3.8 too, if Groq's limits ever bite.

**Which names are private is a rule; where it must trade, privacy wins.** GLiNER cannot tell
the user's name from a public figure's (it hid 52 names on Wikipedia's main page), and
asking it for "famous person" did not help. So `lib/agent/private-names.ts` decides by where
a name appears: every name in the goal (the user's own words), every name on a page that
shows the user's data, a name after words addressing the user ("Welcome back", "Deliver
to"), and any name already hidden in the task, wherever it appears again. The owner's call:
a public name hidden is better than a private one sent, so "search for alan
turing" goes as "search for <PII:NAME:1>", and "Alan Turing" is hidden on every page of that
task. Known gaps:
- A private name on a public page, outside the goal and after no cue words, is readable.
- A business phone number makes a page count as personal, so everything named on it is
  hidden: the eval's search results page loses a celebrity chef and "biryani".
- The cue words are English.

**What the eval finds** (`pnpm eval:node`, 21 fixtures): 100% recall on PII in the
page's text, 87.7% on all PII, 77.3% precision, 8 of 127 near-misses hidden. The misses are
all inside a canvas, an image or a cross-origin iframe, which the Node check cannot capture;
the loop now reads those with OCR, which only the browser run can score. The false positives:
single capitalised words taken for names ("Skrim", "Aadhaar", "biryani", "Koramangala"),
business addresses on personal pages ("Apollo Clinic, Bannerghatta Road", "MG Road
branch"), and the search results page above. The fixtures were written by the same hand as
the fixes, so expect lower numbers on pages we did not write; the browser run
(`pnpm eval`) has not been done yet.

**Name detection is slow on big personal pages.** ONNX Runtime's WASM on one thread takes
about 12 ms a text, and each text is its own model call (batching changed the scores and
was no faster). It now runs only on pages that show the user's data, and only on the part
in and near the view (at most 120 elements), so a personal page costs about 1–1.5 s on its
first view. Faster options: threads (needs the side panel cross-origin isolated), WebGPU,
or a Worker so the chat does not freeze meanwhile.

**The view is a window.** Only elements in the view and a quarter of a view above and below
are listed, at most 120, and the prompt says how many more lie above and below. The planner
must scroll to reach the rest, and a long paragraph is cut at 200 characters. Untried in
Chrome: whether Qwen scrolls when what it needs is not listed.

**Name detection fails open.** If GLiNER cannot load in the side panel, the task continues
with the regex layer and the chat shows a red warning that names and addresses are not being
hidden. That kept the agent usable while the model path was unproven. It loaded in Chrome
(the form fixture's name and address were tokenised), so consider stopping the
task instead.

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
cp .env.example .env     # then add your own Groq key
```

**`.env` lives at the repo root**, not in `apps/server/`. One file for the whole monorepo.
`GROQ_API_KEY` is the only value you must fill in — everything else has a working default.

**Only if you own the model pipeline (workstream 3):**

```powershell
cd scripts
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

> Invoke the venv python by **full path**, always. Never bare `pip install`. Shell
> activation silently failing is how the setup session nuked a global Python install.

**Only if you own the air-gap path:** `winget install Ollama.Ollama` then
`ollama pull qwen3-vl:4b-instruct` (3.3 GB). This is also the fallback when Groq's daily
limit runs out: with Ollama running, start the server with `MODEL_PROVIDER=ollama`.

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
Needs: + own Groq key.
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
  WASM there ([#787](https://github.com/huggingface/transformers.js/issues/787)). Every
  model runs in the side panel, an ordinary extension page on both browsers. The offscreen
  document that used to exist for this was removed, with its permission.
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
