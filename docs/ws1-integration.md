# WS1 Integration Documentation

Workstream 1 (WS1) owns the extension shell, task lifecycle, action dispatch, and verification. This document outlines how other workstreams integrate with WS1.

## Message Contract
Intra-extension messages are defined in `apps/extension/lib/messages.ts` and are **NOT** in `@skrim/schema`.

## Integration Points

The stable code-level integration surface is [apps/extension/lib/integration.ts](../apps/extension/lib/integration.ts). WS1 provides registration points; each workstream supplies its implementation in the correct browser context.

| WS | Integration Point | WS1 Provides | They Provide |
| -- | ----------------- | ------------ | ------------ |
| 2 | `registerScreenGraphProvider()` in the content context | Message routing and action-result handling | `ScreenElement[]` plus the matching `Map<id, Element>` registry |
| 3 | `registerTokenResolver()` in the content context | Resolver injection into type actions | In-memory token resolver and privacy-safe graph adapter |
| 4 | `registerActionPlanner()` in the background context | Goal, observation, task lifecycle, action dispatch | Validated `PlanRequest`/`PlanResponse` flow and one action per cycle |
| 5 | Runtime events | `task.status`, `action.result`, timing samples via `getSamples()` | Playwright test harness |
| 6 | Runtime events | Status, step count, timing via `getSamples()` from `@skrim/shared` | Dashboard visualization |

## How to Plug in a Planner (WS4)
Register a planner from the background context through `registerActionPlanner()`. It receives `{ goal, observation }`, builds a privacy-safe `PlanRequest`, calls the server, validates the response, and returns exactly one `Action`. WS1 forwards that action to the content script and never selects the target itself.

## How to Enhance Observation (WS2)
Register a `ScreenGraphProvider` from the content context. It returns full `ScreenElement[]`, a matching DOM registry, and the `hasVisualCapture` flag. WS1 stores the registry for action execution and forwards the graph; it does not walk the DOM.

## How to Add PII Redaction (WS3)
Register the in-memory token resolver with `registerTokenResolver()` and provide the privacy-safe graph at the WS2 provider boundary. WS1 passes the resolver into type actions and does not implement detection, token storage, or redaction.

## Timing
All timed stages use `timed()` from `@skrim/shared`. WS6 reads `getSamples()` for the resource panel.

## Element ID Contract
IDs are `e0`, `e1`, ..., `e<n>` per `/^e\d+$/`. They are assigned per observe cycle. The server addresses actions at these IDs.
