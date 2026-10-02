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

Your root `.env` needs `NVIDIA_API_KEY` for section 3.

**Load the extension in Chrome**

```powershell
pnpm --filter @skrim/extension build
```

1. `chrome://extensions` → **Developer mode** on (top right).
2. **Load unpacked** → `apps\extension\.output\chrome-mv3`.
3. On the Skrim card → **Details** → turn on **Allow access to file URLs**. The test fixtures
   are local files, and Chrome keeps extensions off `file://` pages unless you allow it.

**After every rebuild:** click **reload ↻** on the Skrim card, then reload the tab you test
on. Chrome does not put the new content script into tabs that were already open; the task
then fails with `CONTENT_SCRIPT_ERROR`.

**Where logs go:** the extension logs ids and counts only, never page content.
- Background: `chrome://extensions` → Skrim card → **service worker** link → Console.
- Page side: DevTools on the page you are testing (F12) → Console.

Lines look like `[skrim] {event: "...", ...}`.

---

## 1. Automated checks

```powershell
pnpm verify
```

Runs the five invariant rules, typechecks all 7 packages, and runs 72 tests:

| Tests | Covers |
|---|---|
| 18 in `@skrim/schema` | The wire contract: PII tokens, URL sanitising, action validation, the outbound PII tripwire |
| 38 in `@skrim/extension` (`lib/pii`, `lib/vault`) | Regex PII detection and the token vault (WS3) |
| 16 in `@skrim/extension` (`lib/vision`) | DOM + vision fusion and the escalation policy (WS2) |

The same command runs in CI on every PR.

---

## 2. PII redaction (WS3)

```powershell
pnpm demo:pii
pnpm demo:pii "Send the invoice to billing@acme.test and call +44 20 7946 0958"
```

Prints the text as the server would see it, with PII replaced by tokens like
`<PII:EMAIL:1>`. It also checks that every token maps back to the original value, without
printing the originals.

What you should notice with the built-in sample:
- Email, phone, card, PAN, UPI, Aadhaar and account number are tokenised.
- **"Suparno" stays visible.** Names need the GLiNER model, which is not wired in yet.
- **"Order #4567890" stays visible, on purpose.** Numbers without context are not PII;
  over-redaction is scored too.
- **Two known bugs show up:** the account number comes out as `GOV_ID` instead of
  `ACCOUNT`, and the vault counts more `ACCOUNT` entries than it shows. Both are in
  CLAUDE.md "Open findings".

---

## 3. Planning server (WS4)

Two terminals:

```powershell
pnpm dev:server          # terminal 1: leave running
pnpm smoke:server        # terminal 2
```

Sends three hand-built requests, the kind the extension will send, and checks each answer:

| Scenario | Pass means |
|---|---|
| click | The model clicks the counter button when asked to increment the counter |
| referential redaction | Asked to enter "my email", it types the token `<PII:EMAIL:1>`, not an invented address |
| knows when to stop | Given history showing the click already worked, it answers `done` |

Each line shows the model's action, whether it matches, and the latency.

**What to expect**:

| Setup | click | types the token | stops when done | Time per step |
|---|---|---|---|---|
| Hosted: Llama 3.2 11B Vision on NVIDIA (the default) | ✅ | ✅ | ❌ clicks again | 1.5–6 s |
| Local: Qwen3-VL 4B on Ollama | ✅ | ✅ | ✅ | 6–57 s |

So with the default, `pnpm smoke:server` ends with **"1 of 3 scenarios failed"**, and pnpm
prints an error after it. That is the model missing the stop case, not a crash. See "The
planner ignores its own history" in CLAUDE.md "Open findings".

**The offline path** needs Ollama running with `qwen3-vl:4b` pulled. Start the server with:

```powershell
$env:MODEL_PROVIDER = "ollama"; pnpm dev:server
```

The first request loads the model into VRAM and can take over a minute; the server waits up
to 120 s for local models.

**To try another hosted model** without editing `.env`:

```powershell
$env:NVIDIA_MODEL = "some/model-id"; pnpm dev:server
```

Being listed on build.nvidia.com does not mean your account can call it. See `.env.example`
for what worked and what didn't.

`$env:...` settings last until you close that terminal.

---

## 4. The extension loop: observe → act → verify (WS1 + WS2)

The server is not connected to the extension yet. A temporary local planner stands in
(`entrypoints/background/dev-planner.ts`). It understands exactly one kind of goal,
**`click <text>`**, where `<text>` is part of a button's or link's accessible name.

1. Open `file:///D:/Programming/skrim/fixtures/pages/click-test.html`.
2. Click the Skrim icon, type `click increment counter`, press **↗**. Keep the popup open.
3. Expected:
   - the page's counter changes to **Count: 1**
   - the popup shows **Completed ✓**

What happened: the content script built the page's element graph (WS2), the planner picked
the element labelled "Increment counter", the click ran (WS1), and a DOM change was seen
before the task ended.

Other goals to try on the same page:

| Goal | Expected on the page | Popup |
|---|---|---|
| `click toggle panel` | a panel appears | Completed ✓ |
| `click accept terms` | the checkbox gets ticked | Completed ✓ |
| `click details` | the accordion opens | Completed ✓ |
| `click something that is not there` | nothing | `GOAL_NOT_ACHIEVED` |
| `find the cheapest flight` | nothing | `GOAL_NOT_ACHIEVED` (the test planner only clicks) |
| `click go to section 2` | jumps to section 2 | Completed ✓ |
| `click skrim click test fixture` (the page title) | nothing | `ACTION_TIMEOUT`: the click changed nothing, so verification correctly fails |

**Known gap:** for buttons, links and checkboxes the click check always passes. The click
routine focuses the element and then counts "it has focus" as a change. So on those, Completed ✓
proves the click was sent, not that it did anything. It is in CLAUDE.md "Open findings".

**See what the DOM extractor found:** open the service-worker console (section 0). Each
observation logs counts by role, e.g.
`[skrim] {event: "planner.dev.observation", total: 18, button: 3, heading: 6, ...}`.

It works on real sites too. On `https://example.com`, try `click learn more`.

---

## 5. Screenshot and OCR (WS1 capture, WS2 OCR)

1. On any normal website (not a `chrome://` page), open the popup → **Capture page**.
   Expected: **✓ Page captured**.
2. A **Read text (OCR)** button appears. Click it. Expected after a few seconds:
   `OCR found N words (M confident). Starts: "..."`. That is the page's text, read from
   the screenshot's pixels on your machine. The first run is slowest while the OCR model
   loads.

This runs OCR directly in the popup as a test. The real pipeline runs it in the offscreen
document, which nothing creates yet. Only tried on Chrome so far.

---

## What cannot be tested yet

| Part | Why |
|---|---|
| Extension ↔ server | No planner that calls `/plan` is registered. The test planner is local |
| PII redaction inside the extension | The detectors exist, but nothing runs them on the page graph, and the vault is not registered as the token resolver |
| Offscreen document | Nothing calls `ensureOffscreenDocument()` |
| Name / address detection (GLiNER) | Only post-processing exists; nothing loads or runs the model |
| Face detection, OmniParser icon detection | Not built. The OmniParser model has not been exported |
| Dashboard, landing page | Still the Vite templates |
| Eval harness | Empty package, no fixtures with ground truth |
| Firefox | Builds, but nothing has been tried in it yet |
