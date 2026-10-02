# WS1 Workflow and Integration Contract

> **Owner:** Workstream 1
> **Scope:** Extension shell, task lifecycle, browser messaging, capture mechanics, action execution, and post-action verification.
> **Rule:** WS1 executes decisions made by other workstreams. It does not implement screen perception, PII detection, token storage, or server planning.

## 1. Purpose

WS1 is the runtime that turns a user goal and the other workstreams' outputs into real browser behavior:

```text
side panel goal
    -> content observation (raw)
    -> WS2 screen graph
    -> WS3 redaction against the task's vault
    -> WS4 one-action plan
    -> WS1 action execution
    -> WS1 verification
    -> repeat
```

The task state and vault are in memory only, in the side panel. No extension state is written
to browser storage.

## 2. Browser contexts

| Context | WS1 responsibility | Must not do |
|---|---|---|
| Side panel | The chat, the agent loop (`lib/agent/loop.ts`): task lifecycle, the vault, redaction, planner calls, step and time limits, the fixed target tab | DOM access to the page |
| Background | Open the side panel from the toolbar button | Anything long-running: Chrome kills the service worker when a `fetch()` takes over 30 s |
| Content script | Answer `page.observe` and `action.execute` (`lib/content-handler.ts`), keep the current DOM registry | Build a second screen graph, redact, or talk to the server |

The loop runs in the side panel rather than the background because of that 30-second rule:
a local model can take longer than that for one step. See CLAUDE.md "Locked decisions".

Firefox and Chrome use the same contracts. Browser-specific behavior belongs in WXT configuration or the smallest platform-specific adapter.

## 3. Message flow

### Start

1. The user sends a goal in the side panel. The loop fixes the target tab (the active tab
   then), creates a task id and an empty vault, and redacts the goal.
2. The side panel sends `{ type: "page.observe", taskId }` to that tab.
3. Content asks the registered WS2 graph provider for a snapshot, stores its `registry`, and
   replies with `page.observation`: raw elements, field hints, URL, title and viewport.

### Plan and act

4. The side panel redacts the observation against the vault (`lib/agent/redact.ts`) and
   builds a `PlanRequest`: sanitised URL, redacted title and elements, tokens in play,
   history, extracted values.
5. The registered WS4 planner calls `assertOutboundSafe()` on the whole request and POSTs it
   to `/plan`. The reply is validated against `PlanResponse`.
6. For a `type` action, the loop swaps its tokens for real values from the vault. An unknown
   token is never typed: the step is recorded as unverified instead.
7. The side panel sends exactly one `action.execute` to the content script, which runs it
   against the current registry and replies `action.result` with `ok`, `changed`, an error
   code when needed, and what the target shows now.

### Continue or finish

8. The step goes into the history with `verified` and a short note. Unverified is not
   failure: the planner sees it and chooses what next. Three unverified steps in a row end
   the task (`NO_PROGRESS`).
9. If the action loaded a new page, the loop waits for the load, then observes again.
10. `done` ends the task. So do errors, cancellation, the 5-minute budget and the 25-step
    limit. The vault is cleared when the task ends, and everything is gone when the panel
    closes.

The server never sends a batch of actions. One observation produces one action, then the page is observed again.

## 4. Stable integration contracts

All contracts below are in [apps/extension/lib/integration.ts](../apps/extension/lib/integration.ts).

### WS2: screen graph provider

WS2 registers a provider in the content-script context:

```ts
registerScreenGraphProvider(() => ({
  elements: safeScreenElements,
  registry: domElementRegistry,
  hasVisualCapture: false,
}));
```

The provider owns:

- candidate selection
- roles and accessible names
- geometry and state
- hierarchy
- DOM/vision fusion
- graph IDs
- graph correctness

The provider must return a registry using the same IDs as `elements`. WS1 only stores that registry and never recomputes the graph.

`ScreenElement` values crossing into `page.observation` must already satisfy the project's privacy contract. WS3 may wrap or replace the WS2 provider before registration if sanitization occurs in the content context.

### WS3: redaction and the vault

There is no registration hook. The loop creates one `TokenVault` (WS3) per task and passes
every observation through `redactPage()` in `lib/agent/redact.ts`, which calls WS3's
detectors. Tokens are resolved with `resolveTokens()` only when a `type` action is about to
run, and the resolved value travels in `action.execute.typedValue`. The content script fails
closed if a value still contains a token.

WS3 owns the detectors and the vault; changes to what counts as PII go there, not in the loop.

### WS4: action planner

The side panel registers the planner at startup (`entrypoints/sidepanel/main.tsx`):

```ts
registerActionPlanner(createServerPlanner(SERVER_URL));
```

An `ActionPlanner` is `(request: PlanRequest, signal: AbortSignal) => Promise<PlanResponse>`.
It receives an already-redacted request and must:

- call `assertOutboundSafe(request)` right before sending anything
- validate the server response against the shared schema
- throw on failure rather than inventing an action; the loop reports the error

Tests and the eval harness can register their own planner. WS1 does not choose a target or
hardcode a verb.

### WS5: evaluation

WS5 should drive the real extension through the existing messages and fixture pages. Useful observable events are:

- the loop's `AgentEvent`s (`started`, `observed`, `planned`, `acted`, `finished`), which
  the side panel renders; `runAgentTask()` takes an `onEvent` callback
- `page.observation`, `action.execute` and `action.result`
- timing samples from `@skrim/shared`

`apps/extension/scripts/agent-check.ts` (`pnpm test:agent`) already runs the loop over the
fixtures in happy-dom; it is a starting point, not the eval.

WS5 should test the shipped browser path rather than calling WS1 action functions alone.

### WS6: dashboard

WS6 consumes task status and timing data. It may display counts, IDs, roles, states, source, latency, and redaction metadata, but must never display or log raw PII.

## 5. WS1-owned features

### Task lifecycle

- start, cancel, complete, fail
- maximum step, time budget and no-progress enforcement
- in-memory vault per task, cleared when it ends
- structured error codes
- events for the side panel chat

### Messaging

- Zod validation at every browser message boundary
- the target tab fixed when the task starts
- following page loads after a click or navigate
- stale or malformed message rejection

### Action execution

WS1 implements the eight schema verbs:

- `click`: scroll, dispatch user-like events, verify state or mutation
- `type`: use the WS3 resolver, set the value, dispatch input/change, optionally submit
- `scroll`: move the page or target element by a bounded amount
- `select`: choose an option by label or value and dispatch input/change
- `navigate`: allow same-origin destinations or back only
- `extract`: resolve a target for the later privacy-safe extraction pipeline
- `wait`: wait for the schema-bounded duration
- `done`: finish successfully without pretending that the page changed

Every action returns a structured result. WS1 must not silently continue after an unverified action.

### Capture mechanics

WS1 owns:

- `captureVisibleTab` access
- cooldown/rate limiting
- in-memory image handling
- cheap frame signatures and capture gating
- timing instrumentation

WS2 owns visual interpretation and fusion. WS3 owns image redaction. WS1 must not decide what a pixel means or send an unredacted image to the server.

## 6. ID and lifecycle rules

- Graph IDs are assigned by WS2, not WS1.
- The same ID must identify the same DOM element in the observation registry.
- IDs must satisfy the shared `e<number>` contract.
- The registry is replaced on every fresh observation.
- An action is executed against the registry produced by the preceding observation.
- After navigation or a meaningful mutation, the next cycle must obtain a new graph.

## 7. Failure behavior

| Failure | WS1 behavior |
|---|---|
| No graph provider | Fail the task with `OBSERVATION_FAILED` |
| Content script unavailable | Fail the task with `CONTENT_SCRIPT_ERROR` and "reload the page" |
| Unknown target, disabled/zero-size target, cross-origin navigation | Record the step as unverified with a note (`TARGET_NOT_FOUND`, `TARGET_NOT_CLICKABLE`, `NAVIGATION_BLOCKED` in the page) |
| Action changed nothing | Record the step as unverified; three in a row fail with `NO_PROGRESS` |
| Unknown PII token | Do not type; record the step as unverified |
| Server unreachable or error | Fail the task with `PLANNER_ERROR` and the server's message |
| Raw PII in a request | Do not send; fail the task with `PII_TRIPWIRE` |
| Planner answers `done` with `success: false` | Fail the task with `GOAL_NOT_ACHIEVED` and its summary |
| Maximum steps or time | `MAX_STEPS_REACHED` (25) or `TASK_TIMEOUT` (5 minutes) |

Logs contain IDs, counts, statuses, timings, and error codes only. They must not contain graph values, goals, screenshots, tokens, or page HTML.

## 8. Testing workflow

From the repository root:

```powershell
pnpm verify
pnpm --filter @skrim/extension build
pnpm --filter @skrim/extension build:firefox
```

Without a browser, `pnpm test:agent` (with `pnpm dev:server` running) runs the fixture
pages through the whole loop in happy-dom. Then in a browser, follow
[`docs/testing.md`](testing.md) section 5: load the build, open a fixture page, give
the side panel a goal, and confirm the page changes, the chat shows verified steps, and the
server log shows counts only.

A build passing by itself does not prove this flow. The real-browser test is required before claiming the vertical slice is complete.

## 9. Files to edit by workstream

| Workstream | Primary files | Do not edit |
|---|---|---|
| WS1 | `entrypoints/`, `lib/agent/loop.ts`, `lib/agent/tab-link.ts`, `lib/content-handler.ts`, `lib/actions/`, `lib/capture/`, `lib/integration.ts`, `lib/messages.ts`, `wxt.config.ts` | WS2 graph logic, WS3 detectors/vault, server planner |
| WS2 | `lib/dom/`, `lib/vision/`, graph-provider registration | WS1 action dispatcher and agent loop |
| WS3 | `lib/pii/`, `lib/vault/`, `lib/agent/redact.ts` | WS1 DOM traversal and action selection |
| WS4 | the server, `lib/agent/server-planner.ts`, planner registration | WS1 action implementation |
| WS5 | `packages/eval/`, fixtures, browser tests | runtime ownership files unless an integration bug is proven |
| WS6 | dashboard and resource visualization | graph construction and privacy logic |
