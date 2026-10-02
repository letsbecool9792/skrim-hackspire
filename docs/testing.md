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

**After every rebuild:** click **reload ↻** on the Skrim card, close and reopen the side
panel, and reload the tab you test on. Chrome does not put the new content script into tabs
that were already open; the task then fails with "Can't work on this tab".

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

Runs the five invariant rules, typechecks all 7 packages, and runs 111 tests:

| Tests | Covers |
|---|---|
| 18 in `@skrim/schema` | The wire contract: PII tokens, URL sanitising, action validation, the outbound PII tripwire |
| 11 in `@skrim/server` | Parsing model output (JSON repair, `<think>` blocks) and the prompt format |
| 45 in `@skrim/extension` `lib/pii`, `lib/vault` | Regex PII detection, form-field hints, the token vault |
| 16 in `lib/vision` | DOM + vision fusion and the escalation policy |
| 12 in `lib/dom`, `lib/actions` | The extractor (visible text, field values, dropdowns) and click verification, in a simulated DOM |
| 9 in `lib/agent` | The whole loop with a scripted planner: redaction, typing via tokens, the no-progress and going-in-circles stops, tripwire, cancel |

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

With the built-in sample, expect email, phone, card, PAN, UPI, Aadhaar and account number to
be tokenised, the Aadhaar as `GOV_ID` and the account number as `ACCOUNT`. Two things stay
visible on purpose:
- **"Suparno".** Free-text names need the GLiNER model, which is not wired in yet. (In forms,
  a field marked as a name *is* redacted, from its `autocomplete` hint.)
- **"Order #4567890".** Numbers without context are not PII; over-redaction is scored too.

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

**Only one server can use port 3000.** If `pnpm dev:server` says `EADDRINUSE`, one is already
running in another terminal. Use that one, or stop it with Ctrl+C first.

### Choosing the model

| Setup | How | Result |
|---|---|---|
| **Ollama, Qwen3-VL 4B instruct (local)** | `ollama pull qwen3-vl:4b-instruct`, then `$env:MODEL_PROVIDER = "ollama"; pnpm dev:server` | **Best so far:** smoke 4 of 4, fixtures 4 of 5, 0.3–0.9 s a step after an ~8 s first load |
| NVIDIA, Llama 3.2 11B Vision (the default) | `NVIDIA_API_KEY` in `.env` | Fast (about 1 s) but **never says done**: on the fixtures it repeated its click until the 25-step limit. Smoke 3 of 4 |
| Groq, Qwen 3.8 27B | `GROQ_API_KEY` in `.env`, then `$env:MODEL_PROVIDER = "groq"; pnpm dev:server` | Not measured yet: needs your key. Free, no card: https://console.groq.com/keys |

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
each goal it prints every step, whether it was verified, the outcome, whether the page ended
up right, and, for the form, whether any raw personal data reached the server (it should
say "none").

This is the quickest way to judge a model: run it with each provider from section 3.

---

## 5. The agent in Chrome

1. Start the server (`pnpm dev:server`) and check the side panel's header shows the model's
   name, not "Server offline".
2. Open `file:///D:/Programming/skrim/fixtures/pages/click-test.html`.
3. Click the Skrim icon. In the side panel, type a goal and press Enter.

| Goal | Expected on the page |
|---|---|
| `Increment the counter once` | **Count: 1**, and the chat shows one verified click, then **✓ Done** |
| `Click show panel` | The panel opens, although the button's hidden name is "Toggle panel". Known miss with Qwen3-VL 4B: the button then says "Hide Panel" and it keeps toggling, until Skrim stops it as "Stuck" |
| `Accept the terms` | The checkbox gets ticked |
| `Open the details section` | The accordion opens |
| `Go to section 2` | The page jumps to section 2 |
| `Find the cheapest flight` | Nothing to click: the model should give up with "Couldn't do that here" |

Then the form: open `fixtures/pages/form-test.html` and try
`Send support a message saying my parcel is late. Use my email from the account box.`
The chat shows "Sent to the server as:" with your goal, and every step the model took; the
email goes in as a labelled "email address 1" pill, and the page gets the real address.
Under the result it says what stayed on the device.

The chat stays for as long as the panel is open. Closing the panel stops a running task and
clears everything.

---

## 6. Screenshot and OCR

In the side panel header, click **Aa**. It captures the visible tab and reads its text with
Tesseract, on your machine, and shows the word count, time and the first words in the chat.
Expect a couple of seconds for a full screen. If it says it could not capture the tab, click
the Skrim toolbar icon again (Chrome grants capture right after that click), then retry.

---

## What cannot be tested yet

| Part | Why |
|---|---|
| Name / address detection in free text (GLiNER) | Only post-processing exists; nothing loads or runs the model |
| Face detection, OmniParser icon detection | Not built. The OmniParser model has not been exported |
| Vision in the loop (OCR, fusion) | The modules exist, but the loop observes the DOM only |
| Dashboard, landing page | Still the Vite templates |
| Eval harness | Empty package, no ground truth yet |
| Firefox | Builds, but nothing has been tried in it yet |
