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

Runs the five invariant rules, typechecks all 7 packages, and runs 166 tests:

| Tests | Covers |
|---|---|
| 21 in `@skrim/schema` | The wire contract: PII tokens, URL sanitising, action validation, the "beyond the view" counts, token usage, the outbound PII tripwire (ISBNs are not cards) |
| 15 in `@skrim/server` | Parsing model output (JSON repair, `<think>` blocks), the prompt format, and how long a rate limit asks to wait |
| 9 in `@skrim/eval` | Scoring: lining redacted text up with the original, recall, precision, IoU, over-redaction |
| 59 in `@skrim/extension` `lib/pii`, `lib/vault` | Regex PII detection (birth dates, labels from the element before), form-field hints, GLiNER's pre- and post-processing and one run of the real model (skipped when it is not fetched), whole addresses, the token vault |
| 19 in `lib/vision` | DOM + vision fusion, the escalation policy, and which regions to read with OCR |
| 17 in `lib/dom`, `lib/actions` | The extractor (visible text, field values, dropdowns, names from images and icons, only what is near the view) and click verification, in a simulated DOM |
| 26 in `lib/agent` | The whole loop with a scripted planner (redaction, typing via tokens, what appeared after each action, an action whose reply never comes, the stops, tripwire, cancel, a refused order), which names are private, and which clicks commit the user |

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
where they may be private (`lib/agent/private-names.ts`): everywhere in the goal, on a page
that shows the user's data, after words like "Welcome back" or "Deliver to", and wherever a
name already hidden appears again. Other names in articles, news and search results stay
readable.

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

From the provider study ([`provider-study.md`](provider-study.md), 14 tasks x 3 runs):

| Setup | How | Result |
|---|---|---|
| **Groq, Qwen 3.8 27B (hosted)** | `GROQ_API_KEY` in `.env`, then `$env:MODEL_PROVIDER = "groq"; pnpm dev:server` | **Best: 42 of 42**, 0.5 s a step. The free tier allows about 4–5 steps a minute (8,000 tokens); the server waits out Groq's short "try again in 2 s" instead of failing |
| **Ollama, Qwen3-VL 4B instruct (local)** | `ollama pull qwen3-vl:4b-instruct`, then `$env:MODEL_PROVIDER = "ollama"; pnpm dev:server` | 31 of 42, 0.6 s a step after an ~8 s first load. Overreaches: it placed an order when asked to change a coupon, which the loop now refuses |
| NVIDIA, Nemotron 3 Super 120B | `NVIDIA_API_KEY` in `.env`, then `$env:NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b"` | 31 of 42, 2.6 s a step; 40 requests a minute and no daily cap |
| NVIDIA, Llama 3.2 11B Vision (still the default) | `NVIDIA_API_KEY` in `.env` | **0 of 42**: it never says done |

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

`pnpm test:agent -- --all` runs all 14 tasks: the six above, plus a goal the page cannot do,
filling a sign-up form, changing a coupon, saving a profile field, a search, opening a
result, replying in a chat, and following a nav link. A task passes only when the page ends
right, the task ends as it should, nothing unasked was touched (no "Place order" when asked
to change a coupon), and no raw personal data reached the server.

### Comparing models: the provider study

To choose a model, run the 14 tasks several times per model and compare, with what each
free tier allows:

```powershell
pnpm --filter @skrim/server probe                  # which free models answer, and Groq's limits
pnpm study -- groq:qwen/qwen3.8-27b                # one model per terminal; several can run at once
pnpm study -- nvidia:openai/gpt-oss-20b
pnpm study -- ollama:qwen3-vl:4b-instruct
pnpm study:report                                  # all results so far, side by side
```

Each `pnpm study` starts its own server for that model (your `pnpm dev:server` is left alone),
waits out rate limits and counts them, and writes `packages/eval/results/study/`. The
report shows passes per task, steps, latency, tokens a step, and how many steps a minute
and tasks a day each free tier allows. The findings are in
[`provider-study.md`](provider-study.md).

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

Then a real site, for example Wikipedia with `Search for Alan Turing`. The chat shows "Sent to
the server as: Search for name 1": every name in a goal is hidden, public or not, because no
rule can tell a public figure from a contact. "Alan Turing" is then hidden on the pages too;
other names stay readable. The first step should come quickly: only the part of the page in
and near the view is read, and name detection does not run on a page that shows none of your
data. Clicking a link that opens a new page continues the task on that page.

Text that exists only as pixels: open `fixtures/pages/canvas-card.html` (an ID card drawn on a
canvas) and ask `What is the PAN on my ID?`. Skrim captures the tab, reads the canvas with
on-device OCR, and hides what it read like any other text, so the answer should show an
"ID number 1" pill rather than the number. This only works while the task's tab is the one
on screen.

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
| Face detection | Not built; it matters once a screenshot goes to the server, and today none does. No eval fixture has a face yet |
| Icon detection, vision fusion | The OmniParser model is not exported; fusion waits for it. (OCR is in the loop: text in a canvas, image or frame is read and redacted) |
| Dashboard, landing page | Still the Vite templates |
| Firefox | Builds, but nothing has been tried in it yet |
