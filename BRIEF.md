# Skrim: a browser agent that never shows the server your data

Our problem statement, the measures we hold ourselves to, the privacy design, and the demo
plan.

---

## 1. The one-line version

We are building a browser extension that can look at your screen and do tasks for you — filling forms, finding things, clicking through multi-step flows — while making it **structurally impossible** for the remote server doing the thinking to ever see your personal information.

Think of every AI browser agent you have seen: Claude in Chrome, OpenAI's Operator, Copilot in Edge. All of them work by shipping your screen to a company's server. That means your bank balance, your medical records, your inbox, and your face are all sitting on somebody else's GPU.

Our version keeps all of that on your machine. The server gets a scrubbed, anonymised description of the screen — enough to reason about, not enough to identify you — and sends back instructions like "click the button in row 3." The extension carries them out locally.

---

## 2. Glossary — read this first

Every acronym used in this document, in plain terms.

| Term | Meaning |
|---|---|
| **PII** | Personally Identifiable Information. Anything that identifies a specific human: name, email, phone number, home address, account number, government ID, face. |
| **DOM** | Document Object Model. The browser's live in-memory tree of everything on a page. It is what you see when you open devtools and inspect an element. JavaScript can read and change it. |
| **ViT** | Vision Transformer. A neural network that looks at images. For our purposes: "the small model that reads pixels." |
| **VLM** | Vision Language Model. A model that accepts images *and* text and replies in text. This is the reasoning brain on the server. Examples: Qwen2.5-VL, InternVL, Llama 3.2 Vision. |
| **LLM** | Large Language Model. Text in, text out. A VLM is an LLM that can also see. |
| **WebGPU** | A modern browser API that lets web pages use the graphics card. This is what makes running an AI model inside a browser tab fast enough to be usable. |
| **WASM** | WebAssembly. Lets compiled code (C++, Rust) run in the browser at near-native speed. Our fallback when WebGPU is unavailable. |
| **ONNX** | A portable file format for trained models. ONNX Runtime Web runs those models inside a browser. |
| **OCR** | Optical Character Recognition. Reading text out of an image. |
| **NER** | Named Entity Recognition. A model that spots names, places, organisations, and similar entities inside text. |
| **Rubric** | How we judge Skrim: five measures, weighted to 100 (see section 3). |
| **MV3** | Manifest V3, the current extension format for Chrome and Firefox. |
| **Air-gapped** | A machine with no network connection at all. "Air-gappable" means the system *could* run that way. |

---

## 3. How we measure it

Five measures, weighted by what a user would feel first. This is our rubric, and every design
decision below traces back to one of these five lines.

| Weight | Measure | What it actually means |
|---|---|---|
| 25% | Understanding the screen | Does the agent correctly understand what is on the page, including what exists only as pixels? |
| 20% | Finding personal data | Do we **find** all the PII, without flagging things that aren't PII? |
| 20% | Hiding it precisely | Do we **remove** it cleanly, without destroying useful context? |
| 20% | Cost on the user's machine | How much RAM, VRAM, and CPU do we burn? |
| 15% | Speed | How long from "user asks" to "task done"? |

Two observations that should shape our priorities:

- **40% of the rubric is measurement, not features.** Finding and hiding are judged on precision and recall. We cannot claim either without an evaluation harness producing real numbers. Build it early.
- **35% of the rubric is performance.** Resource use and latency. Smaller models with published measurements beat bigger models with hand-waving.

---

## 4. Requirements

Six requirements constrain the architecture. Each is easy to get wrong and expensive to fix
later.

### 4.1 Only the structure of the screen goes to the server

Not a blurred screenshot: a **structural abstraction** of the screen — roles, fields, labels, layout — as the primary transport format. Pixels are the fallback, not the default.

### 4.2 A local vision model reads the screen and helps decide

The local model is not only a filter. It takes part in decisions, and the screen goes to the server only **if** reasoning needs it: a router that handles simple things locally and escalates only when real reasoning is needed. Building that router is real work, and it shows.

### 4.3 The server understands the redaction

This is the most important requirement here, and the easiest to skim past.

If we black out an email field, the server can no longer say "type the user's email address there" — it has no idea there was an email there at all. **Redaction therefore cannot be destructive. It has to be referential.** See section 6.

### 4.4 The server's model is open-weight and could run offline

We **do not** use GPT-4o, Gemini, or Claude as the server brain. It must be an open-weight model that could, in principle, run air-gapped: anyone can host it, and the privacy story holds with no network at all. We may call a cloud-hosted copy of that open model rather than hosting it ourselves. Getting this wrong breaks the whole claim, and it is an easy mistake to make early on.

### 4.5 Chrome and Firefox

Both browsers. This is a real portability cost, not a footnote. See section 8.

### 4.6 It works on websites we have never seen

Anyone trying Skrim will point it at sites we have never opened. **No site-specific selectors, ever.** Everything must route through a generic element graph, or we fail on the day regardless of how good the demo looked.

---

## 5. What the product actually is

Three pieces.

### The extension (runs on the user's machine)

Reads the page, finds and protects sensitive data, talks to the server, and physically performs clicks and keystrokes in the page. This is the bulk of the work and where all the interesting problems live.

### The local models (run inside the browser)

Three small neural networks running on the user's own graphics card, via WebGPU:

1. **UI element detection** — spots buttons, fields, and clickable regions in the rendered pixels.
2. **Text PII detection** — a small NER model that finds names and addresses in extracted text. Regular expressions handle the structured formats (emails, phone numbers, card numbers); the model catches what regex cannot.
3. **Face detection** — cheap and fast, for faces in images and video.

### The server (the brain)

An open-weight VLM. It receives the sanitised screen description plus the user's goal, and returns a single next action. It has no memory of the user, no session with them, and no way to identify them.

**Crucially, we are building the agent itself — not a privacy wrapper around somebody else's agent.** It takes a working extension *and* server completing a whole task end to end. A perfect redaction pipeline with no working agent is not a product.

---

## 6. The privacy design

### Two ways to find sensitive data, both local

**DOM redaction** walks the page's element tree in JavaScript. We know a field holds a password because its type says `password`. We know a string is an email from its shape. This is fast, exact, and free.

**The vision model** looks at rendered pixels. We need it because the DOM does not contain everything on screen:

- A `<canvas>` element is one opaque box in the DOM. An entire application can be drawn inside it and the tree tells us nothing.
- A cross-origin `<iframe>` is invisible to our script by browser security design.
- An embedded PDF, a scanned document, a photo of an ID card, a screenshot someone pasted into a chat — all pixels, no text.
- A face is never in the DOM.

DOM for structure and text; vision for everything the DOM cannot see. Fusing both is how we earn the 25% for understanding the screen. A DOM-only agent is blind on any canvas app. A vision-only team is slower and worse at text.

### Redaction never runs on the server

It cannot, by definition. The entire point is that data is sanitised **before** it crosses the network. If the server were doing the redaction, the raw data would already have arrived there and the problem would already have failed.

### Referential redaction: the token vault

PII does not become a black hole. It becomes a **typed token**.

```
Real screen:      Email: suparno@example.com
Sent to server:   { id: "e17", role: "textbox", label: "Email",
                    value: "<PII:EMAIL:1>", bbox: [x,y,w,h] }
```

A lookup table mapping `<PII:EMAIL:1>` back to the real address lives **in memory on the client only**, and never leaves.

The server plans over tokens:

```
Server returns:   { action: "fill", target: "e17", value: "<PII:EMAIL:1>" }
```

The client looks the token up and types the real string into the real field.

This one decision does four jobs simultaneously:

1. Meets requirement 4.3: the server understands the redaction.
2. Keeps the agent functional on forms — destructive redaction would break every fill task.
3. Makes redaction lossless rather than lossy.
4. Gives us something concrete and visual to show judges.

For images we cannot tokenise, we redact the bitmap but ship a **manifest** alongside it: the server learns "there is a human face at these coordinates" instead of staring at an unexplained black rectangle.

### The action space

Fixed and site-agnostic: `click`, `type`, `scroll`, `select`, `navigate`, `extract`, `wait`, `done`.

The server returns one action at a time against element IDs. The client executes, re-observes the screen, and verifies the expected state change before continuing. This **observe → plan → act → verify** loop is what survives websites we have never seen.

---

## 7. Answering the privacy question honestly

Somebody — a judge, a teammate, a user — will ask: *does your software read the sensitive data?*

**Yes. It has to.** We cannot redact something without first identifying it, and the agent has to type the real email into the real field for the task to work at all.

What makes this acceptable is **where the trust boundary sits**. The data is already on the user's machine. The browser fetched it, decrypted it, and rendered it on screen. Our extension reading it adds no new exposure — we are inside a boundary the user already trusts. What the user does *not* trust is a remote server owned by a stranger. **That** is the boundary we defend, and nothing sensitive crosses it.

The correct framing: this is not "software that never sees your data." It is "software that sees your data and provably never lets it leave."

### Engineering that claim so it actually holds

- **Nothing persists.** The token vault is in-memory only, scoped to the current task, wiped when the task ends or the tab closes. No `chrome.storage`, no IndexedDB, no localStorage.
- **No screenshot touches disk.** Capture, infer, discard the buffer in the same cycle.
- **No logging of content.** This is where teams actually leak. A stray `console.log(screenGraph)` writes PII into a log that crash reporters and support tooling can pick up. Log IDs and counts, never values.
- **No telemetry.** Nothing analytics-shaped in the extension at all.
- **Minimal permissions.** The manifest requests exactly what is needed and nothing more. A judge can read it in ten seconds; it is a strong signal.

### Demonstrate it, do not assert it

- Show the outgoing request body live in devtools.
- Show extension storage empty after a complete task run.
- Open the source.

**One caveat to state before a judge does:** detection is statistical, so recall will never be exactly 100%. This is precisely why two of our five measures are precision and recall rather than pass/fail: anyone asking is owed numbers. Report our numbers and our failure modes. Teams that claim perfection get taken apart in questioning.

---

## 8. Technical implementation

### Extension shell

Manifest V3, with `webextension-polyfill` to paper over the `chrome.*` / `browser.*` API split.

Inference runs in a persistent extension page. Chrome offers `chrome.offscreen` for exactly this.

> **Corrected during setup — see §13.** Firefox turns out not to need an equivalent. Its MV3
> background is an *event page*, not a service worker, so it keeps DOM and Web API access
> directly. Chrome is the constrained one here, not Firefox. This divergence is materially
> cheaper than budgeted.

### Model layer

Transformers.js v3 or ONNX Runtime Web, WebGPU backend, WASM fallback.

- UI element detection: a YOLO-class detector (OmniParser-style).
- Text PII: a small quantised NER model.
- Face detection: BlazeFace or a nano YOLO face model.
- OCR: Tesseract.js, only when text must be pulled out of pixels.

Keep total on-disk footprint tight — target well under a few hundred megabytes, cached in OPFS after first run. Resource use is 20% of the rubric.

> **Measured during setup: 63.6 MB**, rising to roughly 76 MB once the icon detector is
> exported. Comfortably inside target. See §13.

### Screen capture and the loop

`tabs.captureVisibleTab` is the simple path, but Chrome rate-limits it to roughly two calls per second, which caps loop frequency.

We should not be running full inference every frame anyway. Drive the pipeline off a `MutationObserver` plus a cheap frame diff, and run the expensive vision pass only when the screen materially changes. **Most of our latency win comes from not running the model**, not from making the model faster.

### The screen graph

Every cycle produces a JSON tree, fused from DOM and vision:

```json
{
  "id": "e17",
  "role": "textbox",
  "label": "Email",
  "value": "<PII:EMAIL:1>",
  "bbox": [412, 260, 280, 36],
  "state": "editable"
}
```

---

## 9. The demo, beat by beat

Four of the five measures are invisible unless we deliberately expose them. The demo is built around exposure.

**1. Split screen, on stage for the entire demo.**
Real page on the left. On the right, a live render of *what the server actually receives* — faces blurred, account numbers tokenised, password fields masked. It updates every cycle. This single view carries 40% of the rubric.

**2. State the task out loud.**
Something multi-step, on a page dense with personal data. A billing portal works well: "download my last three invoices." An inbox works too: "summarise what's unread and draft a reply."

**3. Let it work.**
Agent reads, plans, clicks, types. The right-hand panel tracks the page state live, so judges see redaction happening continuously rather than once.

**4. The wire reveal — the moment that wins it.**
Open devtools mid-demo. Show the outgoing request body: structure and tokens, zero personal data. Then show the field on the real page correctly filled with the real email. Redaction was lossless, and the server still never saw it. Privacy claims are cheap; showing the wire is not.

**5. The image case — the beat that justifies the vision model.**
Load a page where PII sits inside a picture: a scanned ID, a photo of a document. DOM redaction cannot touch it. The local vision model catches it.

Without this beat, a judge will reasonably ask why we did not just run a regex over the DOM and skip the model entirely — and we will have no answer. Build the demo around this gap.

**6. The tradeoff curve.**
Speed and accuracy pull against each other, and the rubric weighs both. Show three model configurations with their measured accuracy-vs-latency points, then say which we shipped and why. Nobody else will have this.

**7. Live resource panel, always on.**
Model footprint, inference milliseconds, memory, end-to-end round trip. That is 35% of the rubric visible in a corner for the whole demo.

**8. Swap the server model.**
Switch to a small open-weight model running locally, offline. Proves the air-gappable claim instead of asserting it.

---

## 10. Build plan

### First: a vertical slice

One page. DOM-only screen graph. Regex-only PII. Hardcoded server prompt. One action type.

**Prove the loop closes before adding a single model.** Everything else layers on top of a working loop; nothing works without one.

### Then, in order

1. Vision model fused into the screen graph
2. Token vault and referential redaction
3. Multi-step planning and verification
4. Firefox port
5. Performance tuning against the resource and latency criteria

### Parallel workstreams

| Owner | Scope |
|---|---|
| 1 | Extension shell, permissions, screen capture, action execution |
| 2 | Screen graph — DOM extraction and vision fusion |
| 3 | PII detection, redaction pipeline, token vault |
| 4 | Server agent, action schema, model selection and hosting |
| 5 | Evaluation harness and metrics |
| 6 | Split-screen demo UI and resource panel |

Workstream 6 is **not decoration**. It is the demo, and it is how 40% of the rubric becomes visible.

### Build the evaluation harness early

Thirty to fifty synthetic pages with ground-truth PII locations, scored for detection recall, redaction IoU, and over-redaction rate.

Two criteria worth 40% are precision measurements. We cannot claim them without numbers. The harness also protects us on the day, when Skrim meets pages we have never seen.

---

## 11. Verify before committing

Four items that could quietly cost a rebuild. All are cheap to settle in an afternoon, before anyone writes real code.

> **All four were settled during setup. Results in §13.** Two came back better than feared,
> one confirmed a hard constraint, one is unfixable and shapes the loop design.

1. **Firefox WebGPU status** on our target OS and browser version. It has shipped, but rollout has been staged per-platform. If Firefox is WASM-only for us, the latency story there is materially different and we need to know now.
2. **ONNX Runtime Web operator coverage** on the WebGPU backend, for the specific models we choose. Unsupported operators fall back to WASM *silently*, and the speedup evaporates without an error message.
3. **Firefox's equivalent of `chrome.offscreen`** for persistent background inference.
4. **CSP behaviour on hardened sites.** Some pages block WASM instantiation in content-script context. This is a further argument for keeping inference in an extension page rather than injected into the page.

---

## 12. Why this problem

- Browser agents are the most current thing in software right now. The framing needs no explanation to any judge who has used a computer this year.
- The novelty is real and defensible: everyone else's agent ships your screen to a server. Ours does not.
- It is TypeScript end to end, with client-side GPU work we already have experience in.
- The genuinely new component — running ONNX models in the browser — is a weekend of learning, not a semester.

The main risk is scope. There are four subsystems here and a portability tax across two browsers. The mitigation is the vertical slice first: get a dumb version of the full loop working end to end, then make each stage smarter.

---

## 13. Verified during setup

Everything below was measured or confirmed on the actual dev machine, not assumed. Where it
contradicts an earlier section, this section wins.

Dev machine: RTX 4050 Laptop (**6141 MiB VRAM**), 15.6 GB RAM, i5-13420H, Chrome 152,
Firefox 149, Node 22.19.

### 13.1 The four §11 items, settled

**1. Firefox WebGPU — better than feared.** Enabled by default on Windows since Firefox 141;
we are on 149. Both browsers get WebGPU. The "Firefox might be WASM-only" latency story is
dead, and we do not need a separate performance narrative per browser.

**2. ONNX Runtime Web operator coverage — still open**, and correctly so: it can only be
answered per model, once each model is actually loaded. Watch for silent WASM fallback. Any
model whose WebGPU path degrades without an error is a latency regression we would otherwise
never notice. Verify per model as they land.

**3. Firefox's `chrome.offscreen` equivalent — not needed at all.** Firefox MV3 uses *event
pages* rather than service workers, so background scripts keep DOM and Web API access. The
divergence runs the opposite way to §8's assumption: **Chrome** is the constrained runtime.
Transformers.js cannot reach WebGPU *or* WASM inside an MV3 service worker
([transformers.js#787](https://github.com/huggingface/transformers.js/issues/787)), so
`chrome.offscreen` is mandatory there — not an optimisation. Firefox needs no counterpart.

**4. CSP on hardened sites — confirmed as a real constraint**, and it reaches further than
§11 anticipated. MV3's own CSP also blocks loading WASM from a CDN inside extension pages.
MediaPipe defaults to fetching its ~11 MB runtime from jsDelivr and will silently fail; the
runtime has to be vendored into the bundle. Same for Tesseract's core. This is a second,
independent argument for keeping inference in an extension page.

### 13.2 Screen capture — unfixable, so design around it

`tabs.captureVisibleTab` is hard-capped at roughly two calls per second and there is **no way
to raise it**. This is not a tuning knob; it is a ceiling on loop frequency. It reinforces
§8: drive the pipeline off MutationObserver plus a cheap frame diff and run the expensive
pass only on material change. Most of the latency win comes from not running the model.

### 13.3 Open weights ≠ free inference

Worth stating plainly because it caused confusion during setup. Qwen3-VL's **weights** are
Apache 2.0 — downloadable, runnable forever, zero cost, which is what satisfies §4.4. What
hosted providers charge for is **GPU time running those weights**. The two are unrelated
axes. Ollama on our own hardware is the same model at zero cost, bounded only by VRAM.

**Free, no-credit-card providers of open-weight models:**

| Provider | Terms | Role |
|---|---|---|
| **NVIDIA Build** | email + one-time phone verify, ~40 RPM, no daily token cap, no expiry | dev default |
| **Cloudflare Workers AI** | 10,000 neurons/day, shared pool | backup |
| OpenRouter | **50 requests/day** without purchased credits | emergency only — unusable daily |
| Ollama (local) | free, unlimited, VRAM-bound | air-gap demo |

All four are OpenAI-compatible, so the server needs exactly one adapter with a swapped
`baseURL`. Demo beat 8 — swapping to a local offline model on stage — is an env var.

One framing worth putting on a slide: free tiers are generally funded by training on your
prompts. For every other team that is a privacy hole. For us it is the thesis — *even if the
provider trains on every request we send, there is nothing identifying in them.*

### 13.4 The 6 GB ceiling is a demo beat, not a limitation

Working VRAM after Windows and Chrome is roughly 4.5 GB.

| Model | Q4 + vision tower + KV | Verdict |
|---|---|---|
| Qwen3-VL-2B | ~2.7 GB | fits; likely too weak for reliable multi-step planning |
| Qwen3-VL-4B | ~4.3–4.5 GB | fits with near-zero headroom — **our ceiling** |
| Qwen3-VL-8B | ~7 GB | **will not fit**; spills to CPU and crawls |

Stated honestly: a 2B model is unlikely to plan multi-step tasks with reliable structured
JSON output, and 4B is borderline. 8B is roughly where this class of task starts working.

This does not need hiding. §9.6 already plans an accuracy-versus-latency curve, so ship
three *measured* points — hosted 32B, hosted 8B, local 4B — and say which we would ship and
why. The hardware limit becomes the slide nobody else has.

Note also that local Ollama and the browser's own WebGPU models contend for the same 6 GB.
Run the air-gap beat with the extension's WebGPU path idle.

### 13.5 Client footprint — measured

**63.6 MB on disk**, roughly 76 MB once the icon detector is exported. Well inside §8's
target and a strong number for the 20% resource criterion.

| Asset | Size |
|---|---|
| GLiNER PII, quantised uint8 ONNX | 44.7 MB |
| GLiNER tokenizer + configs | 3.5 MB |
| MediaPipe vision WASM (SIMD only) | 11.5 MB |
| Tesseract core WASM (LSTM + SIMD only) | 2.8 MB |
| Tesseract `eng.traineddata.gz` | 1.9 MB |
| BlazeFace short-range | 0.2 MB |
| OmniParser icon detector (pending export) | ~12 MB |

Both WASM packages ship every build variant they support; copying all of them cost 78 MB for
no benefit. Shipping only the variants our two target browsers actually load saves 63 MB.

Two things that shortened the pipeline: `knowledgator/gliner-pii-edge-v1.0` already publishes
pre-built ONNX including a uint8 quantisation, so no export is needed — only the OmniParser
YOLO detector requires Python at all. And `optimum[exporters]` no longer exists in optimum
2.x; it is `optimum[onnx]`.

Still to measure: GLiNER uint8 versus fp16, accuracy per millisecond. That comparison *is*
the §9.6 tradeoff curve for the client side.
