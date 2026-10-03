# Skrim

**A browser agent that does the task without your personal data ever leaving your machine.**

AI browser agents work by sending your screen to a company's server, so your inbox, your bank
balance and your face end up on someone else's GPU. Skrim keeps all of that on your device. The
model that does the thinking only ever sees a scrubbed description of the page, with every
private value swapped for a placeholder like `<PII:EMAIL:1>`. The extension swaps the real value
back in only at the moment it types it.

Built by team **Chipotle**. Runs in Chrome, in Firefox on a computer, and **on Android phones**
in Firefox, where Skrim opens as a tab that works on the tab you came from
([`docs/phones.md`](docs/phones.md)). All MV3, one codebase.

| | |
|---|---|
| Landing page | https://skrim-hackspire.vercel.app |
| Extension for Chrome | [skrim-chrome.zip](https://github.com/letsbecool9792/skrim-hackspire/releases/latest/download/skrim-chrome.zip), the latest [release](https://github.com/letsbecool9792/skrim-hackspire/releases) |
| Extension for Firefox | [skrim-firefox.zip](https://github.com/letsbecool9792/skrim-hackspire/releases/latest/download/skrim-firefox.zip) (unsigned, a temporary add-on); on Android see [`docs/phones.md`](docs/phones.md) |
| Live dashboard (what the server receives) | https://skrim-dashboard.vercel.app |
| Planning server | https://skrim-server.vercel.app |

## Contents

[How it works](#how-it-works) · [What the server sees](#what-the-server-sees) ·
[Finding private data](#finding-private-data) · [The numbers](#the-numbers) · [Tradeoffs](#tradeoffs) ·
[Which model plans](#which-model-plans) · [What stops it going wrong](#what-stops-it-going-wrong) ·
[On a phone](#on-a-phone) · [Known limits](#known-limits) · [Run it](#run-it) · [The repo](#the-repo)

## How it works

```
 page (DOM, canvas, images, iframes)                                  your machine
 ─────────────────────────────────────────────────────────────────────────────────
  content script ──► observe ──► read pixels ──► find names ──► redact ──┐
  (element graph)               (OCR + faces)    (GLiNER + rule)  token vault │
                                                                  (memory only)│
                                                                              ▼
                                                 request: placeholders only ──┼───► planning server ──► Qwen
                                                                              │     (stateless, open-weight)
  act ◄── resolve tokens (only when typing) ◄── one action: click / type ... ◄─┘
   │
   └──► verify the page changed ──► next step (max 25 steps, 5 minutes)
```

The loop runs in the side panel, not the background worker: Chrome kills a service worker whose
`fetch()` takes over 30 s, and a local model takes up to 40 s a step. Closing the panel stops the
task and drops its vault.

1. **Observe.** The content script builds an element graph of what is in and near the view (at
   most 120 elements, a quarter of a view of margin, with a count of what lies beyond): role,
   label, value, hint, position, state. Field hints (`autocomplete`, `type`) ride along.
2. **Read pixels.** Canvases, big images and cross-origin iframes hold text the DOM cannot see.
   One capture of the tab, then on-device OCR on just those regions; each line becomes an element
   and is redacted like any other text. Faces in those regions are counted (never kept).
3. **Redact.** Regexes, field hints, a small local NER model and a rule for which names are
   private. Every value gets one token per task however it is written; the vault maps back.
4. **Plan.** The server renders the scrubbed graph as compact text, asks the model for one
   JSON action (click, type, select, scroll, navigate, extract, wait, done), repairs and
   validates it against the shared schema, and replies.
5. **Act and verify.** The extension swaps tokens for real values at typing time only, runs
   the action, and checks that the page changed. A step that did nothing is told so, not repeated.

## What the server sees

A step, as the server receives it (illustrative; compact text, not JSON: one line per element
instead of about ten, which is the difference between one and several steps a minute on Groq's
free tier):

```
Goal: fill in the support form with my name and email

Page: "Contact support" at https://shop.example/help/{id}
Viewport: 1280x720
Elements:
e3 textbox "Full name" = "<PII:NAME:1>" [412,180,320,36]
e4 textbox "Email" = "<PII:EMAIL:1>" [412,232,320,36]
e5 textbox "How can we help?" [412,284,320,120]
e6 button "Send message" [412,430,140,40]
Tokens on this page: <PII:NAME:1> <PII:EMAIL:1>

History, oldest first:
1. {"type":"type","target":"e3","value":"<PII:NAME:1>"} -> verified
```

The dashboard (`apps/dashboard`) renders exactly this, live, beside the page, next to what each
stage cost on the device. There is no screenshot in the request: **pixels are a fallback, not
the default** (see [`BRIEF.md`](BRIEF.md) 4.1). Anything text-like in an image is read by OCR
locally and sent as redacted text.

URLs are cut down too: digit runs, uuids, hashes and anything with an `@` become `{id}`,
`{uuid}`, `{hash}`, `{email}`, a name the task knows becomes `{name}`, and the query string is
reduced to "there is one".

## Finding private data

Two independent finders, both local, merged per text (the earliest and longest match wins):

| Finder | Catches | Notes |
|---|---|---|
| Regex bank | emails, phone numbers with a country code, cards (13-19 digits and Luhn, so ISBNs and order numbers pass), PAN, IFSC, UPI ids; dates of birth, Aadhaar and account numbers **only with a label** ("Aadhaar", "ID card", "Date of birth", "Account no.") from the text or the element before it | Labels read across `<dt>/<dd>` and `<th>/<td>`; 8-18 digit numbers with no label stay readable on purpose |
| Form-field hints | `autocomplete` and `type` (name, address, tel, email, cc-number, bday, password...) | The whole value is trusted, so "221B" in a street field is hidden, not just the part a model recognised |
| GLiNER (`gliner-pii-edge`, uint8) | names and addresses in free text | Threshold 0.6; person and address labels only (organisations are what a planner navigates by). About 12 ms a text on one WASM thread |
| OCR (Tesseract 4 fast, English) | text in canvases, images and cross-origin frames | OCR's slips are handled: "karan mehta@x.com" for "karan.mehta@x.com" is joined to the address |
| Face detector (BlazeFace short range) | faces in those regions | Counts only; there is no screenshot to blur because none is sent |

**Which names are private is a rule, not a guess.** NER cannot tell your name from a public
figure's (it hid 52 names on Wikipedia's main page). So a name is hidden when it is in the goal
(your own words), anywhere on a page that shows your data, right after words that address you
("Welcome back", "Deliver to"), or already hidden earlier in the task. Public pages stay readable
and cost no model time. Where it has to trade, privacy wins: "search for alan turing" goes out as
"search for `<PII:NAME:1>`".

The name model runs only on pages that show your data, and only on what is in view: about 1 s on a
big personal page. If it cannot start, the task stops before sending anything (fail closed).

## The numbers

### Detection (`pnpm eval`)

The harness opens each fixture in a real Chromium with the extension loaded and scores what
`readPage()` sent, the same function the agent runs. Fixtures carry a list of what is private on
the page and a list of look-alikes that must stay readable.

| | |
|---|---|
| Fixtures / private values / look-alikes | 37 / 98 / 183 |
| Recall (hidden everywhere they appear) | **99.0%** (97 of 98) |
| Precision (hidden spans that were private) | **87.5%** |
| Right category | 96 of 97 |
| Span IoU | 0.97 |
| Look-alikes hidden (order numbers, ISBNs, public names) | 8 of 183 |
| Ordinary characters hidden | 1.9% |
| Faces counted | 4 of 5 |

By category: ACCOUNT 5/5, ADDRESS 12/12, CARD 2/2, DOB 8/8, EMAIL 12/12, PHONE 14/14, GOV_ID 8/8,
NAME 35/36, OTHER 1/1. By where it sits: in a field 17/17, in a canvas 3/3, an image 3/3, an iframe
2/2, in the page's text 72/73. The first 22 fixtures scored 100% recall; 15 harder ones took it to
92.9%, and fixing what they found brought it to 99.0%. The one miss is under Known limits. The fixtures are ours, written by the same hands as the
fixes: expect lower on pages we did not write ([`docs/real-site-tests.md`](docs/real-site-tests.md)
is the plan for that).

### On the device

| Model (all run in the side panel, WASM) | On disk |
|---|---|
| GLiNER PII edge, uint8 ONNX + tokenizer | 49.4 MB |
| ONNX Runtime WASM (not a model, but it ships) | about 14 MB |
| Tesseract: English traineddata + LSTM core | 2.1 MB + 7.8 MB |
| MediaPipe WASM + BlazeFace | 12.1 MB + 0.2 MB |
| OmniParser icon detector (YOLO, 1280x1280; exported, not yet used) | 80.9 MB, optional |
| **Built extension** | **87 MB** without the icon detector, 168 MB with it |

Per page view, medians in Chromium: read the page **5 ms**, find names **about 200 ms** (166 to 264 ms over six runs; up to about 1 s
on a big personal page), OCR **0.4 to 0.8 s** when the page has a canvas, image or frame (0
otherwise), redact **under 1 ms**. The first name lookup also loads the model.

### Per step, end to end

| Planner | Tasks passed (14 fixture goals x 3 runs) | Step time p50 / p90 | Tokens a step (in + out) | Free-tier ceiling |
|---|---|---|---|---|
| Groq `qwen/qwen3.8-27b` | **42 of 42** | 0.5 / 0.9 s | 1,566 + 39 | 8,000 tokens a minute, about 4-5 steps; 1,000 requests a day |
| Groq `openai/gpt-oss-120b` | 42 of 42 | 1.0 / 1.6 s | 1,469 + 76 | same, separate quota |
| NVIDIA `nemotron-3-super-120b-a12b` | 37 of 42 (with the prompt rule) | 2.6 / 8.3 s | 1,670 + 222 | 40 requests a minute, no daily cap |
| Ollama `qwen3-vl:4b-instruct`, local, 4k context | 37 of 42 (with the guards) | 0.6 / 1.1 s | 1,544 + 21 | none; about 3.3 GB of VRAM |
| Ollama `skrim-planner` (the same, 16k context), local | 45 of 48 on 16 tasks, as the 4k context | 1.7 / 2.4 s | 1,689 + 23 | none; 5.8 GB, a third on the CPU of a 6 GB card |

Eight models were studied ([`docs/provider-study.md`](docs/provider-study.md)); NVIDIA's old
default, Llama 3.2 11B, did 0 of 42 because it never says "done". Ollama's default 4k context
cuts a longer request from the front; no fixture request came near it (the largest was about
2,000 tokens), but real sites' requests run 3,000 to 12,000. `skrim-planner` (`pnpm ollama:setup`)
gives it 16k: the same tasks pass, and each step is about three times slower, since on a 6 GB
card a third of it runs on the CPU.

## Tradeoffs

Two places where a bigger or looser model buys something and costs something, both measured
([`docs/tradeoffs.md`](docs/tradeoffs.md) has the method and the rest):

**The name model, in the browser eval.** The three ONNX files of the same model, at the shipped
cutoff, and the cutoff on the shipped file:

| Model file | Size | Recall | Precision | Names, median |
|---|---|---|---|---|
| **quint8** (shipped) | **46 MB** | **99.0%** | **87.5%** | **238 ms** |
| fp32 | 181 MB | 99.0% | 82.5% | 356 ms |
| fp16 | 91 MB | 66.3% | 97.1% | 506 ms |

| Cutoff | 0.4 | 0.5 | **0.6** | 0.7 | 0.8 |
|---|---|---|---|---|---|
| Recall | 95.9% | 96.9% | **99.0%** | 92.9% | 75.5% |
| Precision | 73.7% | 81.3% | **87.5%** | 92.9% | 93.8% |

The 8-bit model loses nothing measurable against full precision, at a quarter of the size. Above
0.6, names get through (20 of 36 at 0.8); below it, addresses split into pieces that leave parts
readable, and twice as much ordinary text is hidden.

**The planner.** Qwen 3.8 27B on Groq: 42 of 42 at 0.5 s a step. The local 4B, the only one
that fits a 6 GB laptop GPU: 37 of 42, and it loses its way on real sites. The 16k context real
pages need passes the same tasks but runs a third on the CPU: 1.7 s a step instead of 0.6 s. So
the model that does the task well does not fit on the device, which is why Skrim makes the
hosted one safe instead.

## Which model plans

One OpenAI-compatible adapter, three profiles, swapped by an environment variable: **Groq**
(hosted Qwen 3.8 27B, the default), **Ollama** (local Qwen3-VL 4B, runs with no network: the
air-gap beat of the demo) and **NVIDIA** (Nemotron, no daily cap). When Groq says to come back
later, `FALLBACK_PROVIDER` plans that step instead. The server is stateless: no user identity, no
session, nothing stored. It is open-weight only by rule: no GPT, Gemini or Claude as the brain,
so the whole thing can be deployed offline.

## What stops it going wrong

Rules enforced by machine, not by hoping ([`CLAUDE.md`](CLAUDE.md), "Guardrails"):

- **Outbound tripwire.** `assertOutboundSafe()` scans every request body and throws on a raw
  email, Luhn-valid card, PAN or international phone. The shared logger throws on the same in dev.
- **Five invariant rules** run on every PR (`pnpm check`): nothing is persisted
  (`localStorage`, `chrome.storage`, IndexedDB), no raw `console.*`, no closed-model SDK, the
  schema package imports nothing, no analytics. A text scan, so no inline comment can silence it.
- **The vault is memory only**, one per task. Unknown tokens in a planned value fail the step:
  typing `<PII:EMAIL:7>` into a real form is the one thing never done.
- **Unasked commitments are refused**: place an order, pay, delete, create an account,
  subscribe or transfer, unless the goal says so. This exists because the local model once placed
  an order when asked to change a coupon code.
- **Limits**: 25 steps, 5 minutes, a stop after repeated unverified steps, and a refused repeat
  of the same step on an unchanged page.
- **No telemetry, no screenshot on disk, ids and counts in logs, never values.**

## On a phone

Skrim runs on Android in Firefox, the same add-on as on a computer. Firefox for Android has no
sidebar, so the toolbar button opens Skrim as a tab of its own that works on the tab it was
opened from (`sidepanel.html?tab=<id>`); the models run on the phone and the hosted server
plans. Tried on a phone with Firefox 157: a task ran on Wikipedia end to end. Chrome on phones
runs no extensions at all, which is why Firefox is the phone route today and why the pipeline is
meant to be a library for phone agents too. The routes compared, and how to install:
[`docs/phones.md`](docs/phones.md).

## Known limits

Said plainly, because a judge will find them:

- **English only.** Names, labels and cue words ("Welcome back") are English; Hindi was tried
  and dropped.
- **One eval miss:** the NER model does not find "Meera Iyer" at the head of "Meera Iyer, Rohan
  Iyer and Tara Iyer". The false positives are mostly street and place names taken for addresses
  or names, and a search results page where a business phone makes everything look personal.
  Plain 10-digit mobile numbers with no country code are not caught by the regex bank (only
  `+91...` and `tel` fields are).
- **A private name on a public-looking page is readable** unless it is in the goal, follows a
  cue word, is in an email address on the page, or sits beside a face.
- **The planner sees text only.** A task that needs to look at a picture (a chart, a CAPTCHA) is
  out of reach until a redacted-screenshot path exists; OCR covers text in images.
- **Free tiers are the bottleneck.** Groq allows about 4-5 steps a minute and real pages cost
  more tokens than our fixtures do; the 4B local model is the weakest planner of the three.
- **Our fixtures are our own.** Real-site results are pending.

## Tests

`pnpm verify` runs the invariants, typechecks all 7 packages, and 234 tests: the wire contract
(35), the server's parsing, prompt and limits (20), the scorer (11), and the extension (168:
detectors, the loop with a scripted planner, redaction of text read from pixels, which names are
private, URL handling, vision, DOM extraction). CI runs it on every PR. `pnpm test:agent` runs
the whole loop against a real planner on fixture pages; `pnpm study` measures a model on 16
tasks. [`docs/testing.md`](docs/testing.md) says how to see each part work.

## Run it

### Without building anything

Download [skrim-chrome.zip](https://github.com/letsbecool9792/skrim-hackspire/releases/latest/download/skrim-chrome.zip)
and unzip it. In Chrome: `chrome://extensions`, turn on Developer mode, **Load unpacked**, and
choose the unzipped folder. Open any page, click Skrim's toolbar button, and ask it to do
something. It plans with the hosted server (Qwen 3.8 27B on Groq's free tier, shared by everyone
trying it: a few steps a minute). To watch what the server receives, open
https://skrim-dashboard.vercel.app in the same browser while the side panel is open.

In Firefox on a computer: download [skrim-firefox.zip](https://github.com/letsbecool9792/skrim-hackspire/releases/latest/download/skrim-firefox.zip),
open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick the zip. It lasts
until Firefox closes. On an Android phone: [`docs/phones.md`](docs/phones.md), "How to install it".

### From source

Needs Node 22, pnpm (`npm install -g pnpm`), and a free Groq key.

```powershell
git clone https://github.com/letsbecool9792/skrim-hackspire.git
cd skrim-hackspire
pnpm install
pnpm models:fetch                 # on-device models; the first run also sets up Python for the icon detector (~10 min, skip with --skip-icon)
cp .env.example .env              # then put your GROQ_API_KEY in it
pnpm dev:server                   # the planning server
pnpm --filter @skrim/extension build
```

Then in Chrome: `chrome://extensions`, turn on Developer mode, **Load unpacked**, and choose
`apps/extension/.output/chrome-mv3`. Open any page, click Skrim's toolbar button, and ask it to do
something. For the live dashboard, run `pnpm dev:dashboard` and open the address it prints.

For the offline planner: `ollama pull qwen3-vl:4b-instruct`, `pnpm ollama:setup`, then
`$env:MODEL_PROVIDER = "ollama"; pnpm dev:server`.

## The repo

| | |
|---|---|
| `apps/extension` | The product: side panel, agent loop, on-device models, WXT for Chrome and Firefox |
| `apps/server` | Planner: one OpenAI-compatible adapter (Groq, Ollama, NVIDIA), prompt, JSON repair; one Vercel function when hosted |
| `apps/dashboard` | The live view of what the server sees and what it costs |
| `apps/web` | The landing page |
| `packages/schema` | The contract (Zod) shared by all of them, so a mismatch is a compile error |
| `packages/eval` | The harness behind the numbers above |
| `design/tokens.css` | The shared look; fonts are bundled, nothing is fetched |
| `fixtures` | Synthetic pages with a list of what is private on each |

How the hosted copies are deployed: [`docs/deploy.md`](docs/deploy.md). Where the project stands, what was decided and why: [`CLAUDE.md`](CLAUDE.md). The problem, the
scoring and the privacy design: [`BRIEF.md`](BRIEF.md).

## Licences

The code is ISC. Each model keeps its own licence: check them before shipping anything. Qwen is
Apache 2.0; the OmniParser icon detector is **AGPL-3.0**.
