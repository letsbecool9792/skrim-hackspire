# WS1 Integration Documentation

Workstream 1 (WS1) owns the extension shell, task lifecycle, action dispatch, and verification. This document outlines how other workstreams integrate with WS1.

## Message Contract
Intra-extension messages are defined in `apps/extension/lib/messages.ts` and are **NOT** in `@skrim/schema`.

## Integration Points

| WS | Integration Point | WS1 Provides | They Provide |
| -- | ----------------- | ------------ | ------------ |
| 2 | `page.observe` response | Element registry (id, role, bbox, state) via content script | Full `ScreenElement[]` with labels, values, source via `lib/dom/` |
| 3 | Before server request | Raw observation values | Tokenised values via vault, `RedactionManifest` via `lib/pii/` and `lib/vault/` |
| 4 | After observation | `PlanRequest`-shaped payload | Single `Action` via `PlanResponse` |
| 5 | Runtime events | `task.status`, `action.result`, timing samples via `getSamples()` | Playwright test harness |
| 6 | Runtime events | Status, step count, timing via `getSamples()` from `@skrim/shared` | Dashboard visualization |

## How to Plug in a Planner (WS4)
In `entrypoints/background/index.ts`, the hardcoded click dispatch is currently marked as the WS4 integration point. Replace it with the following flow: build a `PlanRequest` from the observation, POST it to the server, validate the `PlanResponse`, and forward the `Action` to the content script.

## How to Enhance Observation (WS2)
The content script's `buildRegistry()` returns basic element info. WS2 replaces/enhances this with full `ScreenElement` extraction from `lib/dom/`, adding labels, values, source, and children.

## How to Add PII Redaction (WS3)
Between observation and server request, WS3 pipes the observation through `lib/pii/` detection and `lib/vault/` tokenisation.

## Timing
All timed stages use `timed()` from `@skrim/shared`. WS6 reads `getSamples()` for the resource panel.

## Element ID Contract
IDs are `e0`, `e1`, ..., `e<n>` per `/^e\d+$/`. They are assigned per observe cycle. The server addresses actions at these IDs.
