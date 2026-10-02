# Testing what exists

How to see each part of Skrim working. Everything runs on your machine.
What still can't be tested, and why, is at the bottom. What is left to build is in
[`CLAUDE.md`](../CLAUDE.md) under "Status" and "Open findings".

---

## 0. Setup (once, and after pulling)

```powershell
pnpm install
pnpm models:fetch        # re-run after pulling: new model files get added over time
```

Your root `.env` needs `NVIDIA_API_KEY` (or `GROQ_API_KEY`, see section 3).

**Load the extension in Chrome**

```powershell
pnpm --filter @skrim/extension build
```

1. `chrome://extensions` → **Developer mode** on (top right).
2. **Load unpacked** → `apps\extension\.output\chrome-mv3`. If an older Skrim card is there,
   remove it first: the popup is gone and the permissions changed.
3. On the Skrim card → **Details** → turn on **Allow access to file URLs**. The test fixtures
   are local files, and Chrome keeps extensions off `file://` pages unless you allow it.
4. Pin Skrim to the toolbar (puzzle-piece icon → pin). Clicking it opens the **side panel**.

**After every rebuild:** click **reload ↻** on the Skrim card, then close and reopen the side
panel. Tabs that were already open are fine: Skrim starts itself in them. Removing the card
and loading it again turns **Allow access to file URLs** back off; without it, the fixtures
fail with a message saying so.

**The side panel header shows which model the server is using.** If it says
`llama-3.2-11b-vision-instruct` when you meant to use Ollama, an older server is still
running on port 3000 (see section 3).

**Where logs go.** Nothing logs page content: ids, counts and timings only.

| What | Where |
|---|---|
| The planning server | The terminal running `pnpm dev:server`. One line per step, like `[plan] step 0, 18 elements, 0 in history -> click e12 in 912 ms, 0 repairs` |
| The agent loop (side panel) | Right-click inside the side panel → **Inspect** → Console |
| The content script | DevTools on the page you are testing (F12) → Console |

Lines from the extension look like `[skrim] {event: "agent.planned", ...}`.

---

## 1. Automated checks

```powershell
pnpm verify
```

Runs the five invariant rules, typechecks all 7 packages, and runs 156 tests:

| Tests | Covers |
|---|---|
| 20 in `@skrim/schema` | The wire contract: PII tokens, URL sanitising, action validation, the "beyond the view" counts, the outbound PII tripwire (ISBNs are not cards) |
| 12 in `@skrim/server` | Parsing model output (JSON repair, `<think>` blocks) and the prompt format |
| 9 in `@skrim/eval` | Scoring: lining redacted text up with the original, recall, precision, IoU, over-redaction |
| 59 in `@skrim/extension` `lib/pii`, `lib/vault` | Regex PII detection (birth dates, labels from the element before), form-field hints, GLiNER's pre- and post-processing and one run of the real model (skipped when it is not fetched), whole addresses, the token vault |
| 16 in `lib/vision` | DOM + vision fusion and the escalation policy |
| 17 in `lib/dom`, `lib/actions` | The extractor (visible text, field values, dropdowns, names from images and icons, only what is near the view) and click verification, in a simulated DOM |
| 23 in `lib/agent` | The whole loop with a scripted planner (redaction, typing via tokens, what appeared after each action, an action whose reply never comes, the stops, tripwire, cancel), and which names are private |

The same command runs in CI on every PR.

---

## 2. PII redaction

```powershell
pnpm demo:pii
pnpm demo:pii "Send the invoice to billing@acme.test and call +44 20 7946 0958"
```

Prints the text as the server would see it, with PII replaced by tokens like
`<PII:EMAIL:1>`, and checks that every token maps back to the original value, without
printing the originals.

The first line says whether name and address detection (the GLiNER model) is on; it needs
`pnpm models:fetch`. With the built-in sample, expect the name and the address (`via ner`)
and the email, phone, card, PAN, UPI, Aadhaar and account number (`via regex`) to be
tokenised: the Aadhaar as `GOV_ID`, the account number as `ACCOUNT`. "Order #4567890" and
"Friday" stay visible on purpose: over-redaction is scored too.

Try your own sentences to see what the model misses: a name tucked into a long sentence full
of other data ("Hi, I'm Suparno. Email ...") often slips through.

The demo shows everything the detectors find. In a task, names and addresses are hidden only
where they are private (`lib/agent/private-names.ts`): on a page that shows the user's data,
after words like "Welcome back" or "Deliver to", and wherever a name already hidden appears
again. Names in articles, news and search results stay readable.

---

## 3. Planning server

Two terminals:

```powershell
pnpm dev:server          # terminal 1: leave running; its log is here
pnpm smoke:server        # terminal 2
```

Sends four hand-built requests and checks each answer: a click, typing the token
`<PII:EMAIL:1>` rather than an invented address, answering `done` when the history shows
the goal is reached, and clicking a button by its visible text. Each line shows the action,
whether it matched, and the latency.

**Only one server can use port 3000.** If `pnpm dev:server` says the port is already in use,
a server from earlier is still running in another terminal, perhaps with a different
provider. Stop it with Ctrl+C in that terminal, then start the one you want. Changing
`$env:MODEL_PROVIDER` does nothing to a server that is already running.

### Choosing the model

| Setup | How | Result |
|---|---|---|
| **Groq, Qwen 3.8 27B (hosted)** | `GROQ_API_KEY` in `.env`, then `$env:MODEL_PROVIDER = "groq"; pnpm dev:server` | **Best**: fixtures 6 of 6 with no wasted steps, 0.5–0.9 s a step. But the free tier allows **7,000 input tokens a minute** and a step is about 1,500, so **4–5 steps a minute**; past that the task fails with "rate limit reached". `pnpm test:agent` hits it on its 5th request |
| **Ollama, Qwen3-VL 4B instruct (local)** | `ollama pull qwen3-vl:4b-instruct`, then `$env:MODEL_PROVIDER = "ollama"; pnpm dev:server` | Fixtures 6 of 6, 0.3–0.9 s a step after an ~8 s first load; sometimes clicks a field before typing into it. Smoke 4 of 4 |
| NVIDIA, Llama 3.2 11B Vision (the default) | `NVIDIA_API_KEY` in `.env` | Fast (about 1 s) but **never says done**: on the fixtures it repeated its click until the 25-step limit. Smoke 3 of 4 |

`$env:...` settings last until you close that terminal. To make one permanent, set
`MODEL_PROVIDER` (and `OLLAMA_MODEL=qwen3-vl:4b-instruct`, if your `.env` names a model) in
the root `.env`. The plain `qwen3-vl:4b` tag is the "thinking" build: 5–40 s a step.

---

## 4. The agent, end to end, without a browser

```powershell
pnpm dev:server          # terminal 1
pnpm test:agent          # terminal 2
```

Runs the real loop on the fixture pages in a simulated DOM (happy-dom), against the real
server and model: extraction, redaction, the vault, planning, actions and verification. For
each of the six goals it prints every step, whether it was verified, what the planner was
told about it afterwards (`told: now it is expanded; appeared: ...`), the outcome, whether
the page ended up right, and, for the form, whether any raw personal data reached the
server (it should say "none").

This is the quickest way to judge a model: run it with each provider from section 3. On
Groq's free tier it runs into the rate limit (section 3).

---

## 5. The agent in Chrome

1. Start the server (`pnpm dev:server`) and check the side panel's header shows the model's
   name, not "Server offline".
2. Open `file:///D:/Programming/skrim/fixtures/pages/click-test.html`.
3. Click the Skrim icon. In the side panel, type a goal and press Enter.

Each goal should take one click, then **✓ Done**:

| Goal | Expected on the page |
|---|---|
| `Increment the counter once` | **Count: 1** |
| `Click show panel` | The panel opens, although the button's hidden name is "Toggle panel". It must not click again: the button then says "Hide Panel" |
| `Accept the terms` | The checkbox gets ticked |
| `Open the details section` | The accordion opens, and stays open |
| `Go to section 2` | The page jumps to section 2, and the task ends there |
| `Find the cheapest flight` | Nothing to click: the model should give up with "Couldn't do that here" |

Then the form: open `fixtures/pages/form-test.html` and try
`Send support a message saying my parcel is late. Use my email from the account box.`
The chat shows every step the model took; the email goes in as a labelled "email address 1"
pill, and the page gets the real address. The name and phone fields may stay empty: the
form does not need them and the goal did not ask. The **ⓘ** button under the result says
what stayed on the device: here a name, an email address, a phone number and an address.

Then a real site, for example Wikipedia with `Search for Alan Turing`. There should be no
"Sent to the server as" line: a public name stays as written. The first step should come
quickly: only the part of the page in and near the view is read, and name detection does
not run on a page that shows none of your data. Clicking a link that opens a new page
continues the task on that page.

The chat stays for as long as the panel is open. Closing the panel stops a running task and
clears everything.

---

## 6. Detection on the fixtures (the eval)

`fixtures/pages/` holds 21 synthetic pages with PII in known places, and
`fixtures/ground-truth/` says what on each is PII and what only looks like it. The eval
scores what Skrim hid: recall, precision, span IoU, near-misses hidden, over-redaction and
time per stage, then lists every miss and false positive by name.

**The numbers to report** come from the real extension in Chromium:

```powershell
pnpm --filter @skrim/eval exec playwright install chromium   # once: Playwright's Chromium, ~150 MB
pnpm eval                                                     # builds the eval extension, then scores
pnpm eval -- --headed                                         # to watch it
pnpm eval -- --save                                           # also writes packages/eval/SUMMARY.md
```

It prints a report and writes it to `packages/eval/results/browser-latest.md`
(gitignored). Chromium, not Chrome: branded Chrome no longer loads unpacked extensions
from the command line.

**A quick check while changing detection**, in Node, no browser:

```powershell
pnpm eval:node
```

Same detection code and scoring, but happy-dom instead of a browser and onnxruntime-node
instead of the WASM build, so its numbers are not the ones to report. On the 21 fixtures it gave
100% recall on PII in the page's text (57 of 57), 87.7% on all PII (the rest is inside a
canvas, an image or an iframe), 77.3% precision, and 8 of 127 near-misses hidden.

---

## What cannot be tested yet

| Part | Why |
|---|---|
| Face detection, OmniParser icon detection | Not built. The OmniParser model has not been exported |
| Vision in the loop (OCR, fusion) | The modules exist, but the loop observes the DOM only. OCR itself read the fixtures in Chrome in 0.1–0.4 s, through a test button since removed |
| Dashboard, landing page | Still the Vite templates |
| Eval: faces | No fixture with a face yet; BlazeFace is not wired either |
| Firefox | Builds, but nothing has been tried in it yet |
