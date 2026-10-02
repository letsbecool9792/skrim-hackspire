# apps/extension

The product. Chrome MV3 + Firefox MV3, built with WXT.

Read [`/BRIEF.md`](../../BRIEF.md) for what we are building and why.
Read [`/CLAUDE.md`](../../CLAUDE.md) for current status and locked decisions.

## Where code goes

| Path | Runs where | Purpose |
|---|---|---|
| `entrypoints/background.ts` | Chrome: service worker. Firefox: event page | Orchestrator. The agent loop, task state, server calls |
| `entrypoints/offscreen/` | Chrome only, hidden document | **All model inference.** Nothing else |
| `entrypoints/content.ts` | Injected into the page | DOM extraction, action execution |
| `entrypoints/sidepanel/` | Extension UI | Task input, progress |
| `lib/*` | Imported by the above | The actual logic. Each has its own CLAUDE.md |

## Rules that are not negotiable

**No inference in the background script.** On Chrome it is a service worker, and
Transformers.js cannot reach WebGPU *or* WASM there
([#787](https://github.com/huggingface/transformers.js/issues/787)). Model code goes in
`entrypoints/offscreen/`. This is not a preference, it silently fails otherwise.

**No `localStorage`, `sessionStorage`, `indexedDB`, or `chrome.storage`. Anywhere.**
`pnpm check` fails the build if you add one. The privacy claim is "nothing persists", and a
judge will open the storage inspector after a run.

**No `console.*`.** Use `log` from `@skrim/shared`. It scans for raw PII and throws in
dev, which is how you find a leak in your own time rather than on stage. `pnpm check`
enforces this.

**No site-specific selectors.** Not one. Skrim has to work on websites nobody on this
team has seen (brief §4.6). If your code contains `.checkout-button` or `#login-form`, it will
fail on the day no matter how well the demo went.

**Redact before it leaves the client.** Anything read from the DOM is real user data until
the PII pipeline has tokenised it. The last line of defence is `assertOutboundSafe()` from
`@skrim/schema` — call it in the one place that makes the network request.

## Writing for both browsers

Write for Chrome's constraints; Firefox is strictly more permissive. Branch with
`import.meta.env.FIREFOX` only where the platforms genuinely differ (the offscreen document
being the main case). Never fork a whole module per browser.

```powershell
pnpm dev              # chrome
pnpm dev:firefox
```

## Tests

Put tests next to the code as `lib/**/*.test.ts`, using Node's built-in `node:test` and
`node:assert/strict`. No Vitest, no Jest: CI runs `node --import tsx --test "lib/**/*.test.ts"`,
so a test written for another runner, or placed outside `lib/`, silently never runs.

## Before you open a PR

```powershell
pnpm verify           # from the repo root: invariants + typecheck + tests
```
