# Workstream 1 — Browser Extension Shell & Local Action Runtime

> **Owner:** WS1  
> **Status:** WS1 runtime implemented; WS2/WS3/WS4 registration contracts available; full integration pending

For the current workflow and exact integration contracts, read [`ws1-workflow.md`](ws1-workflow.md).

---

## Table of Contents

1. [What Was Built](#1-what-was-built)
2. [Architecture Overview](#2-architecture-overview)
3. [File-by-File Walkthrough](#3-file-by-file-walkthrough)
4. [The Data Flow (How It All Connects)](#4-the-data-flow)
5. [How to Test Before Touching the Browser](#5-how-to-test-before-touching-the-browser)
6. [How to Load and Test in the Browser](#6-how-to-load-and-test-in-the-browser)
7. [Integration Points for Other Workstreams](#7-integration-points-for-other-workstreams)
8. [What Phase 1 Does NOT Do Yet](#8-what-phase-1-does-not-do-yet)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What Was Built

WS1 is the **extension skeleton** — the runtime that makes everything else possible. It
implements the **observe → plan → act → verify** loop that every other workstream plugs into.

The WS1 runtime provides the loop mechanics. The complete loop becomes executable after WS2,
WS3, and WS4 register their providers:

- **Observe:** The content script calls the registered WS2 graph provider, stores its DOM
  registry, and forwards the graph to the background.
- **Plan:** The background calls the registered WS4 planner with the goal and observation.
- **Act:** The content script executes one validated action against the registry.
- **Verify:** WS1 checks the action result and starts a fresh observation cycle when needed.

Additionally:
- A **popup UI** lets you type a goal, start/cancel a task, and see live status.
- **Screenshot capture** is rate-limited, kept in memory, and gated before WS2 interprets it.
- A **click-test fixture page** is included for manual and automated testing.
- The `sidePanel` permission was dropped from the manifest (unused permissions are a scored
  signal for judges).

### Files created or modified

```
apps/extension/
├── entrypoints/
│   ├── background/
│   │   ├── index.ts              ← The orchestrator (observe→plan→act→verify loop)
│   │   ├── task-manager.ts       ← In-memory task state machine
│   │   └── message-router.ts     ← Cross-context messaging helpers
│   ├── content/
│   │   ├── index.ts              ← Injected into every page, handles observe + act
│   │   └── observer.ts           ← MutationObserver for change detection
│   └── popup/
│       └── App.tsx               ← Task controls UI (replaced the counter template)
├── lib/
│   ├── errors.ts                 ← 10 structured error codes
│   ├── id.ts                     ← Task and action ID generation
│   ├── task-state.ts             ← TaskState type, defaults
│   ├── messages.ts               ← 7-variant message contract (Zod validated)
│   ├── actions/
│   │   ├── dispatcher.ts         ← Central action dispatch + validation
│   │   ├── click.ts              ← Click implementation (Phase 1 focus)
│   │   └── stubs.ts              ← non-click action implementations
│   └── capture/
│       ├── screenshot.ts         ← captureVisibleTab wrapper, rate-limited
│       └── frame-diff.ts         ← Mutation/time and frame-signature gating
└── wxt.config.ts                 ← Modified: dropped sidePanel permission

fixtures/pages/click-test.html    ← Self-contained fixture for click testing
docs/ws1-integration.md           ← Integration guide for WS2–WS6
```

---

## 2. Architecture Overview

The extension has three execution contexts that communicate via message passing:

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│                                                             │
│  ┌──────────────┐    messages     ┌──────────────────────┐  │
│  │    POPUP     │ ◄────────────► │     BACKGROUND        │  │
│  │  (React UI)  │                │  (Service Worker /    │  │
│  │              │  task.start    │   Event Page)         │  │
│  │  Goal input  │  task.cancel   │                       │  │
│  │  Status bar  │  task.status   │  • Task lifecycle     │  │
│  │              │                │  • Message routing    │  │
│  └──────────────┘                │  • [WS4] Server calls │  │
│                                  └──────────┬───────────┘  │
│                                             │               │
│                                   page.observe              │
│                                   action.execute            │
│                                   page.observation          │
│                                   action.result             │
│                                             │               │
│                                  ┌──────────▼───────────┐  │
│                                  │    CONTENT SCRIPT     │  │
│                                  │  (Runs in the page)   │  │
│                                  │                       │  │
│                                  │  • Element registry   │  │
│                                  │  • MutationObserver   │  │
│                                  │  • Action execution   │  │
│                                  │  • [WS2] DOM graph    │  │
│                                  │  • [WS3] PII redact   │  │
│                                  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Why three contexts?

This is a Chrome MV3 constraint, not a choice:

| Context | Runs as | Has DOM? | Has WebGPU? | Can access page? |
|---|---|---|---|---|
| Background | Service worker (Chrome) / Event page (Firefox) | ❌ Chrome, ✅ Firefox | ❌ | ❌ |
| Content script | Injected into the web page | ✅ (page's DOM) | ❌ | ✅ |
| Popup | Extension popup window | ✅ (own DOM) | ❌ | ❌ |
| Offscreen *(not yet)* | Hidden document (Chrome only) | ✅ | ✅ | ❌ |

The background orchestrates, the content script does the work in the page, and the popup is
the user's control panel. They can only talk through `browser.runtime.sendMessage` and
`browser.tabs.sendMessage`.

---

## 3. File-by-File Walkthrough

### Foundation Types (`lib/`)

These are the shared contracts used by all three contexts.

#### `lib/errors.ts` — Error Codes

```typescript
type ErrorCode =
  | 'TARGET_NOT_FOUND'      // element ID not in registry
  | 'TARGET_NOT_CLICKABLE'  // element is hidden, disabled, or zero-size
  | 'ACTION_TIMEOUT'        // action produced no change
  | 'UNSUPPORTED_ACTION'    // unavailable integration or action
  | 'MALFORMED_ACTION'      // ActionSchema.safeParse failed
  | 'MAX_STEPS_REACHED'     // hit 25-step limit
  | 'TASK_CANCELLED'        // user pressed Cancel
  | 'CONTENT_SCRIPT_ERROR'  // content script unreachable
  | 'OBSERVATION_FAILED'    // DOM walk failed
  | 'NAVIGATION_BLOCKED';   // isNavigationAllowed() returned false
```

**Why structured codes instead of thrown errors?** Thrown exceptions silently vanish when
crossing the `browser.runtime.sendMessage` boundary. A code in a result object survives the
journey and lets the background (or a future planner) decide what to do.

#### `lib/messages.ts` — Message Contract

Every message crossing a `sendMessage` boundary is validated with Zod at both ends. This
catches garbled messages at the boundary instead of letting them propagate as silent bugs.

The 7 message types:

| Direction | Type | Payload | When |
|---|---|---|---|
| Popup → Background | `task.start` | `{ goal }` | User clicks Start |
| Popup → Background | `task.cancel` | *(none)* | User clicks Cancel |
| Background → Content | `page.observe` | `{ taskId }` | Start of each cycle |
| Background → Content | `action.execute` | `{ action, actionId, taskId }` | After planning |
| Content → Background | `page.observation` | `{ taskId, observationVersion, elementCount, hasVisualCapture }` | After DOM walk |
| Content → Background | `action.result` | `{ ok, actionId, changed, errorCode?, observationVersion }` | After action |
| Background → Popup | `task.status` | `{ status, taskId?, stepCount?, maxSteps?, errorCode? }` | On every state change |

**Why not in `@skrim/schema`?** The schema package is the client↔server wire format,
shared with the Node server and eval harness. These popup↔background↔content messages are
internal plumbing — putting them in the schema would pollute the shared contract and
create coupling where none is needed.

`parseMessage(data)` returns `Message | null` — never throws. If the data doesn't match
any of the 7 schemas, you get `null` and the message is silently ignored (it might be from
a different extension or browser internal).

#### `lib/task-state.ts` — Task State

```typescript
interface TaskState {
  taskId: string;           // crypto.randomUUID()
  goal: string;             // what the user typed
  status: TaskStatus;       // 'idle'|'running'|'waiting'|'completed'|'failed'|'cancelled'
  stepCount: number;        // how many actions executed so far
  maxSteps: number;         // 25 (safety limit)
  observationVersion: number;
  startedAt: number;        // Date.now()
  timeoutMs: number;        // 120_000 (2 minutes)
  lastErrorCode?: ErrorCode;
}
```

This lives **only in the background service worker's memory**. It is NEVER persisted to
`chrome.storage`, `localStorage`, or any other storage. When the task ends (or the service
worker dies on Chrome), it's gone. This is the privacy guarantee.

#### `lib/id.ts` — ID Generation

- `newTaskId()` → `crypto.randomUUID()` (e.g. `"a1b2c3d4-..."`)
- `newActionId(stepCount)` → `"a0"`, `"a1"`, `"a2"` (monotonic within a task)

---

### Background Orchestrator (`entrypoints/background/`)

This is the brain. It owns the loop.

#### `background/index.ts` — The Main Loop

On startup, logs `background.started` and registers a message listener. On each message:

1. **`task.start`** → Creates task state, broadcasts status to popup, sends `page.observe`
   to the content script in the active tab.
2. **`task.cancel`** → Sets status to cancelled, broadcasts, clears state.
3. **`page.observation`** → The content script finished observing the page. The background
  calls the planner registered through `registerActionPlanner()` with the task goal and
  observation, then forwards exactly one validated action.
4. **`action.result`** → If `ok && changed`, increment step counter, send next
   `page.observe`. If max steps reached, fail the task. If action failed, fail the task.

#### `background/task-manager.ts` — State Machine

A singleton object with methods: `start(goal)`, `cancel()`, `complete()`, `fail(errorCode)`,
`incrementStep()`, `getState()`, `isRunning()`, `clear()`.

State transitions:
```
idle → running → (waiting) → running → ... → completed | failed | cancelled
```

`clear()` wipes the state entirely — call it after broadcasting the final status.

#### `background/message-router.ts` — Messaging Helpers

Three functions that wrap the browser messaging API with error handling:

- `sendToContent(tabId, message)` — `browser.tabs.sendMessage`. Logs type + tabId only.
- `broadcastStatus(status, taskId, extra?)` — `browser.runtime.sendMessage` for the popup.
  Catches errors silently (popup might be closed — that's expected, not a bug).
- `getActiveTabId()` — `browser.tabs.query({ active: true, currentWindow: true })`.

---

### Content Script (`entrypoints/content/`)

Injected into every page (`<all_urls>`, `document_idle`). Two jobs: observe the page and
execute actions.

#### `content/index.ts` — Message Handler

On injection, starts the MutationObserver and registers a message listener:

- **`page.observe`** → Calls the registered WS2 provider, stores its registry, and returns
  the graph elements and visual-capture flag.
- **`action.execute`** → Executes the action against the registry from the preceding graph.

#### `lib/integration.ts` — Workstream Registration Surface

WS1 provides three registration points:

- `registerScreenGraphProvider()` — WS2 supplies graph elements and the matching DOM registry.
- `registerTokenResolver()` — WS3 supplies the in-memory token lookup used by type actions.
- `registerActionPlanner()` — WS4 supplies one validated action per observation.

WS1 does not implement the graph, privacy pipeline, vault, or planner.

#### `content/observer.ts` — Change Detection

A `MutationObserver` on `document.body` watching for:
- `childList` changes (elements added/removed)
- Attribute changes on interactive elements: `class`, `disabled`, `aria-expanded`,
  `aria-checked`, `aria-selected`, `value`, `checked`, `hidden`

Each meaningful batch of mutations increments a version counter. "Meaningful" means childList
changes or attribute changes on interactive elements — a clock ticking or a caret blinking
doesn't count.

`getObservationVersion()` returns the current counter. The click handler uses this to detect
whether the page actually changed after a click.

---

### Action Runtime (`lib/actions/`)

#### `actions/dispatcher.ts` — Central Dispatch

`executeAction(action, actionId, registry, getObservationVersion)`:

1. Validate with `ActionSchema.safeParse(action)` — returns `MALFORMED_ACTION` if invalid.
2. Switch on `action.type`:
   - `click` → `executeClick()`
   - `done` → return `{ ok: true, changed: false }` (task complete)
   - everything else → `executeStub()` → `UNSUPPORTED_ACTION`
3. Wrap in `timed('action.execute', ...)` for timing instrumentation.
4. **Never throws** — always returns `ActionResult`.

#### `actions/click.ts` — The Click Implementation

This is the most critical file for the demo. The sequence:

1. **Resolve target** — `registry.get("e0")` → `TARGET_NOT_FOUND` if missing.
2. **Check clickability** — visible? enabled? non-zero size? → `TARGET_NOT_CLICKABLE`.
3. **Scroll into view** — `element.scrollIntoView({ block: 'center', behavior: 'instant' })`.
4. **Snapshot pre-click state** — observation version, checked state, aria-expanded, classList.
5. **Dispatch events in user order:**
   ```
   pointerdown → mousedown → focus → mouseup → click
   ```
   This is the order a real mouse produces. Framework-managed inputs (React, Vue, Angular)
   often ignore a bare `.click()` — they listen for the full sequence.
6. **Wait for mutations** — up to 500ms, polling every 50ms.
7. **Verify** — did the observation version increase? Did element state change (checked,
   aria-expanded, className)?
8. **Return** — `{ ok: true, changed: true/false }`.

#### `actions/stubs.ts` — Non-click Action Implementations

Contains the WS1 implementations for `type`, `scroll`, `select`, `navigate`, `extract`, and
`wait`. Token lookup is delegated to the WS3 resolver.

---

### Popup (`entrypoints/popup/App.tsx`)

Replaced the WXT+React counter template with:

- **Textarea** — "Describe what you want done on this page…"
- **Start button** — sends `task.start` to background. Disabled when empty or task running.
- **Cancel button** — sends `task.cancel`. Only visible during running/waiting.
- **Status display** — color-coded: blue=running, green=completed, red=failed, orange=cancelled.
- **Step counter** — `3 / 25` format.
- **Error display** — shows the error code if task failed.

---

### Capture (`lib/capture/`)

#### `capture/screenshot.ts`

`captureIfNeeded(tabId)`:
- 500ms cooldown guard (Chrome hard-caps `captureVisibleTab` at ~2/sec).
- Returns `Uint8Array` in memory — **never touches disk**.
- Parses PNG header for dimensions.
- Wrapped in `timed('capture', ...)`.
- Returns `null` on failure or rate limit — never throws.

The capture helper is available to the visual-perception integration and remains in memory.

#### `capture/frame-diff.ts`

`shouldCapture()` gates work using mutation count and elapsed time. Frame signatures provide a
cheap additional comparison; WS2 remains responsible for visual interpretation.

---

## 4. The Data Flow

Here's what happens when you click "Start" with the goal "Click the toggle button":

```
1. POPUP                          2. BACKGROUND
   User types goal,                  Receives task.start
   clicks Start                      Creates TaskState {
   ──────────────────►                 taskId: "abc-123",
   { type: "task.start",              status: "running",
     goal: "Click the                 stepCount: 0,
            toggle button" }           maxSteps: 25
                                     }
                                     Broadcasts task.status to popup
                                     Sends page.observe to content tab

3. CONTENT SCRIPT                 4. BACKGROUND
  Receives page.observe             Receives page.observation
  Calls the registered WS2 provider  { elementCount: 12,
  Stores its matching registry       observationVersion: 0 }
  Returns the sanitized graph        Calls the registered WS4 planner
   ──────────────────►                 Sends action.execute
                                       { action: { type: "click",
                                                   target: "e0" },
                                         actionId: "a0" }

5. CONTENT SCRIPT                 6. BACKGROUND
  Receives action.execute           Receives action.result
  Executes against the current graph { ok: true, changed: true }
   Resolves e0 → <button>
   Checks: visible? enabled?          Step 0 succeeded!
   Scrolls into view                  Increments to step 1
   Dispatches pointer/mouse           Sends next page.observe
   events                             ──────────────────►
   Waits for mutations                (cycle repeats from step 3)
   Verifies state changed
   Returns action.result
   ──────────────────►
```

The loop repeats until:
- An action with `type: "done"` is received (task completes)
- 25 steps are reached (`MAX_STEPS_REACHED`)
- An action fails (`ACTION_TIMEOUT`)
- The user cancels

---

## 5. How to Test Before Touching the Browser

### Step 1: Verify the build (mandatory, takes ~50 seconds)

```powershell
# From the repo root
pnpm verify
```

This runs three things in sequence:

| Step | Command | What it checks |
|---|---|---|
| 1. Invariants | `pnpm check` | no-persistence, no-raw-console, no-closed-models, schema-imports-nothing, no-telemetry |
| 2. Typecheck | `pnpm typecheck` | `tsc --noEmit` across all 7 workspace packages |
| 3. Tests | `pnpm test` | 18 schema contract tests |

If `pnpm verify` passes, the code is structurally sound. As of the last run:
- ✅ 5 invariant rules, 0 violations
- ✅ 7/7 packages typecheck clean
- ✅ 18/18 schema tests pass

### Step 2: Build both browsers

```powershell
# Chrome MV3
pnpm --filter @skrim/extension build

# Firefox MV3
pnpm --filter @skrim/extension build:firefox
```

Both produce output in `apps/extension/.output/chrome-mv3/` and `.output/firefox-mv3/`
respectively. If the build succeeds, the extension is loadable.

### Step 3: Unit tests (recommended to add)

The following modules are testable without a browser. You'd add **vitest** with jsdom:

```powershell
# One-time setup (from apps/extension/)
pnpm add -D vitest jsdom @vitest/coverage-v8
```

Add to `apps/extension/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

#### What to test and how:

**`parseMessage()` — highest value, pure logic:**
```typescript
import { parseMessage } from '../lib/messages.ts';

// ✅ Valid messages parse correctly
const msg = parseMessage({ type: 'task.start', goal: 'click button' });
assert(msg?.type === 'task.start');

// ✅ Invalid messages return null (not throw)
assert(parseMessage({ type: 'unknown' }) === null);
assert(parseMessage(null) === null);
assert(parseMessage("garbage") === null);

// ✅ Validates fields — empty goal rejected
assert(parseMessage({ type: 'task.start', goal: '' }) === null);
```

**`task-manager` — state machine transitions:**
```typescript
import { taskManager } from '../entrypoints/background/task-manager.ts';

// Start creates state
const state = taskManager.start('test goal');
assert(state.status === 'running');
assert(state.stepCount === 0);

// Increment step
assert(taskManager.incrementStep() === true);  // step 1 of 25

// Cancel transitions correctly
taskManager.cancel();
assert(taskManager.getState()?.status === 'cancelled');

// Clear wipes everything
taskManager.clear();
assert(taskManager.getState() === null);
```

**WS2 graph provider — browser integration test:**
```typescript
import { registerScreenGraphProvider } from '../lib/integration.ts';

document.body.innerHTML = `
  <button>Click me</button>
  <input type="text" />
  <a href="#">Link</a>
  <div aria-hidden="true"><button>Hidden</button></div>
`;

registerScreenGraphProvider(() => ({ elements: [], registry: new Map(), hasVisualCapture: false }));

// WS2 owns graph candidate, role, label, state, and ID assertions.
// WS1 asserts that the provider registry is used for action execution.
```

**`click.ts` — event dispatch + verification:**
```typescript
import { executeClick } from '../lib/actions/click.ts';

// Create a checkbox
document.body.innerHTML = '<input type="checkbox" id="cb" />';
const cb = document.querySelector('#cb')!;
const registry = new Map([['e0', cb]]);
let version = 0;

const result = await executeClick('e0', 'a0', registry, () => version);
assert(result.ok === true);

// TARGET_NOT_FOUND for missing element
const miss = await executeClick('e99', 'a1', registry, () => version);
assert(miss.errorCode === 'TARGET_NOT_FOUND');
```

---

## 6. How to Load and Test in the Browser

### Chrome

```powershell
# Option A: Dev mode with hot reload (recommended during development)
pnpm --filter @skrim/extension dev

# Option B: Production build then load
pnpm --filter @skrim/extension build
```

Then:

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Navigate to `apps/extension/.output/chrome-mv3/` (for build) or the path shown in the
   dev server output
5. The extension "Private Browser Agent" appears with the WXT icon

### Firefox

```powershell
# Dev mode
pnpm --filter @skrim/extension dev:firefox

# Or production build
pnpm --filter @skrim/extension build:firefox
```

Then:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Navigate to `apps/extension/.output/firefox-mv3/` and select `manifest.json`

### Manual Test Sequence

Once loaded:

#### Test 1: Popup Opens
1. Click the extension icon in the toolbar
2. You should see: "Private Browser Agent" header, textarea, Start button, Status: IDLE

#### Test 2: Start a Task
1. Open `fixtures/pages/click-test.html` in a tab (or any page)
   - For the fixture: right-click → Open with → your browser, or serve it:
     ```powershell
     npx serve fixtures/pages -p 3333
     ```
     Then open `http://localhost:3333/click-test.html`
2. Click the extension icon
3. Type any goal (e.g. "test click")
4. Click Start
5. **Expected:** Status changes to RUNNING, step counter starts incrementing
6. The extension will repeatedly click `e0` (the first interactive element it finds)

#### Test 3: Verify Action Execution
1. Open DevTools (F12) → Console
2. Filter for `[skrim]`
3. You should see structured log entries like:
   ```
   [skrim] { event: "background.started", browser: "chrome" }
   [skrim] { event: "task.started", taskId: "abc-123" }
   [skrim] { event: "content.observed", elementCount: 5, version: 0 }
   [skrim] { event: "action.dispatched", type: "click", actionId: "a0" }
   [skrim] { event: "action.completed", actionId: "a0", ok: true, changed: true }
   ```
4. **Key check:** No raw values, no HTML, no PII in any log line — only IDs, counts, booleans.

#### Test 4: Background Service Worker Logs
1. Go to `chrome://extensions`
2. Find "Private Browser Agent"
3. Click **"Inspect views: service worker"** (Chrome) or check the debugging page (Firefox)
4. This opens DevTools for the background — you can see the task manager logs here

#### Test 5: Cancel
1. While a task is running, click the extension icon
2. Click Cancel
3. Status should show CANCELLED

#### Test 6: Verify No Persistence
1. After a task completes or is cancelled:
2. Open DevTools → Application → Storage
3. Check: Local Storage, Session Storage, IndexedDB, Extension Storage
4. **All should be empty.** The extension stores nothing.

#### Test 7: Click-Test Fixture Page
1. Open `fixtures/pages/click-test.html`
2. Start a task from the popup
3. Watch the first element (toggle button) — it should receive clicks
4. The button text should toggle between "Show Panel" / "Hide Panel"
5. Check the console for `action.completed` with `changed: true`

---

## 7. Integration Points for Other Workstreams

### WS2 — Screen Graph (DOM Extraction + Vision Fusion)

**Where to plug in:**
[`entrypoints/content/index.ts`](../apps/extension/entrypoints/content/index.ts), in the
`page.observe` handler.

**Current state:** WS1 calls the provider registered through `registerScreenGraphProvider()`.

**What WS2 does:** Provide full `ScreenElement[]` from `lib/dom/` and the matching registry, adding:
- Accessible names (aria-label, label associations, placeholder, text content)
- Values (for inputs — but tokenised by WS3 first!)
- `source: "dom" | "vision" | "fused"`
- `children[]` for hierarchy
- Emit `<canvas>`, cross-origin `<iframe>`, `<img>` as elements with the right role for
  `lib/vision/` to fill in

**The contract:** Element IDs must stay `e<n>` format (`/^e\d+$/`). The server returns
`{ action: "click", target: "e17" }` — if `e17` means something different between observe
and execute, we click the wrong thing.

### WS3 — PII Detection, Redaction, Token Vault

**Where to plug in:** Between observation and the server request (in the background, once
WS4 wires the server call).

**What WS3 does:**
1. Pipe the observation through `lib/pii/` detection (regex bank → GLiNER NER → BlazeFace)
2. Tokenise detected values via `lib/vault/` → `<PII:EMAIL:1>`
3. Attach `RedactionManifest` to the `ScreenGraph`
4. Before the server request: `assertOutboundSafe()` from `@skrim/schema` as last-resort
   tripwire

**Also:** When executing a `type` action, the vault resolves `<PII:EMAIL:1>` back to the
real string. If resolution fails → abort the step, never type the literal token into a form.

### WS4 — Server Agent, Action Schema, Providers

**Where to plug in:** `registerActionPlanner()` from `apps/extension/lib/integration.ts`,
registered in the background context.

**What WS4 does:**
1. Build `PlanRequest` from the observation (using types from `@skrim/schema`)
2. POST to the planning server (`apps/server/`)
3. Validate `PlanResponse` with `ActionSchema`
4. Forward the returned `Action` + `actionId` to the content script via `action.execute`

**The server returns one action at a time.** The loop is: observe → plan → **one action** →
verify → observe again. Not a batch.

### WS5 — Eval Harness and Metrics

**Integration points:**
- `task.status` and `action.result` messages for tracking execution
- `getSamples()` from `@skrim/shared` for timing data
- `fixtures/pages/` for test pages
- Playwright drives a real browser with the extension loaded

### WS6 — Dashboard Split-Screen and Resource Panel

**Integration points:**
- `getSamples()` and `summary()` from `@skrim/shared` for the resource panel
- Task status, step count for the progress display
- The dashboard connects to the extension via a content script or messaging bridge

---

## 8. What Phase 1 Does NOT Do Yet

| What | Status | Who |
|---|---|---|
| Server planner call | Registration hook available, planner not registered yet | WS4 |
| Full ScreenElement extraction | Registration hook available, provider not registered yet | WS2 |
| PII detection + redaction | Not wired | WS3 |
| Token vault | Not wired | WS3 |
| Vision pipeline (OCR, face, icon detect) | Models fetched, not loaded | WS2+WS3 |
| `type`, `scroll`, `select`, `navigate`, `extract`, `wait` | Implemented in WS1 dispatcher; external planner/privacy integration still required | WS1 + other workstreams |
| Screenshot in the loop | Wired but not called | WS2 |
| Offscreen document (Chrome inference) | Not created | WS2 |
| Dynamic injection (activeTab) | Using static `<all_urls>` match | WS1 (pre-PPT) |
| Unit tests | None yet | WS1 |

---

## 9. Troubleshooting

### "The extension doesn't load"

```powershell
# Make sure WXT prepared its types
pnpm --filter @skrim/extension postinstall

# Then build
pnpm --filter @skrim/extension build
```

### "Content script doesn't inject"

- Check `chrome://extensions` → the extension should show `<all_urls>` in permissions
- The content script only runs at `document_idle` — wait for the page to fully load
- Check for errors in the extension's background service worker DevTools

### "Log says 'router.sendToContent.failed'"

- The content script isn't injected in that tab yet. Navigate to a real page first
  (not `chrome://extensions` or `chrome://newtab` — these block content scripts)

### "Action always returns TARGET_NOT_FOUND"

- The element registry rebuilds on every `action.execute`. If the page changed between
  observe and execute, the IDs shift. This is expected — the solution is re-observe.
- Check that the page has interactive elements (buttons, links, inputs)

### "invariant check fails"

```powershell
pnpm check
```

Read the error message — it explains exactly which rule was violated and why. Common ones:
- `no-raw-console`: You used `console.log` instead of `log` from `@skrim/shared`
- `no-persistence`: You used `localStorage` or `chrome.storage` somewhere

### "Firefox build warns about missing ID"

This is expected. Add `browser_specific_settings` to `wxt.config.ts` when ready for AMO
submission:

```typescript
// In manifest: { } block of wxt.config.ts
browser_specific_settings: {
  gecko: {
    id: "skrim@tropical-crush",
    strict_min_version: "128.0"
  }
}
```

