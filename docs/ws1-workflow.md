# WS1 Workflow and Integration Contract

> **Owner:** Workstream 1
> **Scope:** Extension shell, task lifecycle, browser messaging, capture mechanics, action execution, and post-action verification.
> **Rule:** WS1 executes decisions made by other workstreams. It does not implement screen perception, PII detection, token storage, or server planning.

## 1. Purpose

WS1 is the runtime that turns a user goal and the other workstreams' outputs into real browser behavior:

```text
popup goal
    -> background task
    -> content observation
    -> WS2 screen graph
    -> WS3 privacy-safe graph
    -> WS4 one-action plan
    -> WS1 action execution
    -> WS1 verification
    -> repeat
```

The task state and vault are in memory only. No extension state is written to browser storage.

## 2. Browser contexts

| Context | WS1 responsibility | Must not do |
|---|---|---|
| Background | Task lifecycle, active-tab routing, planner invocation, step limits, final status | DOM access, WebGPU/WASM inference, PII detection |
| Content script | Receive graph/action messages, retain the current DOM registry, execute actions, return results | Build a second screen graph or send raw values to the server |
| Popup | Collect goal, start/cancel task, show status and errors | Plan actions or inspect the active page DOM |
| Chrome offscreen page | WS1 provides the integration location if needed | WS1 does not implement model inference here |

Firefox and Chrome use the same contracts. Browser-specific behavior belongs in WXT configuration or the smallest platform-specific adapter.

## 3. Message flow

### Start

1. Popup sends `{ type: "task.start", goal }` to the background.
2. Background creates an in-memory `TaskState` with a task ID and step limit.
3. Background sends `{ type: "page.observe", taskId }` to the active tab.
4. Content asks the registered WS2 graph provider for a snapshot.
5. Content stores the snapshot's `registry` for later action execution.
6. Content sends `page.observation` with the graph elements and visual-capture flag.

### Plan and act

7. Background passes the goal and observation to the registered WS4 planner.
8. WS4 builds a `PlanRequest` using the privacy-safe graph and calls the server.
9. WS4 validates the server's `PlanResponse` with the shared schema.
10. Background sends exactly one `action.execute` message to the content script.
11. Content executes the action using the current registry.
12. Content returns `action.result` with `ok`, `changed`, and an error code when needed.

### Continue or finish

13. Background accepts success only when the action result is verified.
14. For a continuing task, background requests a fresh observation.
15. For `done`, the planner ends the task and the popup receives `completed`.
16. On failure, cancellation, timeout, or step limit, background broadcasts the final status and clears memory.

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

### WS3: token resolver

WS3 registers the in-memory resolver in the content-script context:

```ts
registerTokenResolver((value) => vault.resolve(value));
```

WS1 passes this callback to the type-action executor. WS1 does not inspect, detect, generate, persist, or resolve tokens itself. An unresolved PII token fails closed and is never typed literally.

WS3 also owns sanitizing graph labels, values, hints, extracted data, screenshots, and any request body before the request reaches WS4/server code.

### WS4: action planner

WS4 registers the planner in the background context:

```ts
registerActionPlanner(async ({ goal, observation }) => {
  const request = buildPlanRequest(goal, observation);
  const response = await plannerClient.plan(request);
  return response.action;
});
```

The planner must:

- use the shared `PlanRequest` and `PlanResponse` schemas
- send one action only
- include privacy-safe graph data
- validate the server response
- return `null` when planning fails rather than inventing an action

WS1 supplies the task goal and observation. WS1 does not choose a target or hardcode a verb.

### WS5: evaluation

WS5 should drive the real extension through the existing messages and fixture pages. Useful observable events are:

- `task.status`
- `page.observation`
- `action.execute`
- `action.result`
- timing samples from `@skrim/shared`

WS5 should test the shipped browser path rather than calling WS1 action functions alone.

### WS6: dashboard

WS6 consumes task status and timing data. It may display counts, IDs, roles, states, source, latency, and redaction metadata, but must never display or log raw PII.

## 5. WS1-owned features

### Task lifecycle

- start, cancel, complete, fail
- maximum step enforcement
- in-memory timeout and cleanup
- structured error codes
- popup status broadcasts

### Messaging

- Zod validation at every browser message boundary
- active-tab lookup
- content-script routing
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
| No graph provider | Return an observation with no graph and fail the task clearly |
| Content script unavailable | Report `CONTENT_SCRIPT_ERROR` |
| Unknown target | Report `TARGET_NOT_FOUND` |
| Disabled/zero-size target | Report `TARGET_NOT_CLICKABLE` |
| No expected click change | Report `ACTION_TIMEOUT` |
| Unresolved PII token | Fail closed with `CONTENT_SCRIPT_ERROR` |
| Cross-origin navigation | Report `NAVIGATION_BLOCKED` |
| Invalid server action | Report `MALFORMED_ACTION` |
| Maximum steps reached | Report `MAX_STEPS_REACHED` |

Logs contain IDs, counts, statuses, timings, and error codes only. They must not contain graph values, goals, screenshots, tokens, or page HTML.

## 8. Testing workflow

From the repository root:

```powershell
pnpm verify
pnpm --filter @skrim/extension build
pnpm --filter @skrim/extension build:firefox
```

Integration testing should then:

1. Build the extension.
2. Load the Chrome or Firefox output.
3. Open a normal HTTP fixture page.
4. Confirm the content script registers a WS2 provider.
5. Confirm a graph observation reaches the background.
6. Register a deterministic test planner that returns a schema-valid action.
7. Register a test WS3 resolver for token actions.
8. Confirm the action changes the fixture page.
9. Confirm the next observation uses a fresh registry.
10. Confirm no raw values appear in logs or outbound requests.

A build passing by itself does not prove this flow. The real-browser test is required before claiming the vertical slice is complete.

## 9. Files to edit by workstream

| Workstream | Primary files | Do not edit |
|---|---|---|
| WS1 | `entrypoints/background/`, `entrypoints/content/index.ts`, `lib/actions/`, `lib/capture/`, `lib/integration.ts`, `lib/messages.ts`, `wxt.config.ts` | WS2 graph logic, WS3 detectors/vault, server planner |
| WS2 | `lib/dom/`, `lib/vision/`, graph-provider registration | WS1 action dispatcher and task manager |
| WS3 | `lib/pii/`, `lib/vault/`, privacy adapter and token resolver registration | WS1 DOM traversal and action selection |
| WS4 | server planner/provider and planner registration | WS1 action implementation |
| WS5 | `packages/eval/`, fixtures, browser tests | runtime ownership files unless an integration bug is proven |
| WS6 | dashboard and resource visualization | graph construction and privacy logic |
