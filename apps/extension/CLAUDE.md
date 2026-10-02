# apps/extension

The product. Chrome MV3 + Firefox MV3, built with WXT.

Read [`/BRIEF.md`](../../BRIEF.md) for what we are building and why.
Read [`/CLAUDE.md`](../../CLAUDE.md) for current status and locked decisions.

## Where code goes

| Path | Runs where | Purpose |
|---|---|---|
| `entrypoints/sidepanel/` | Extension page beside the tab | The chat UI. **The agent loop runs here** (`lib/agent/`), with the task's vault |
| `entrypoints/background/` | Chrome: service worker. Firefox: event page | Opens the side panel on the toolbar click. Nothing else |
| `entrypoints/offscreen/` | Chrome only, hidden document | Meant for model inference; unused, and maybe unnecessary now (see CLAUDE.md "Open findings") |
| `entrypoints/content/` | Injected into the page | Answers the side panel: the page graph, and actions (`lib/content-handler.ts`) |
| `lib/*` | Imported by the above | The actual logic. Most folders have their own CLAUDE.md |

## Rules that are not negotiable

**Nothing long-running in the background script.** On Chrome it is a service worker: it is
killed when a `fetch()` takes over 30 s, and Transformers.js cannot reach WebGPU *or* WASM
there ([#787](https://github.com/huggingface/transformers.js/issues/787)). The loop and
server calls live in the side panel. This is not a preference, it silently fails otherwise.

**No `localStorage`, `sessionStorage`, `indexedDB`, or `chrome.storage`. Anywhere.**
`pnpm check` fails the build if you add one. The privacy claim is "nothing persists", and a
judge will open the storage inspector after a run.

**No `console.*`.** Use `log` from `@skrim/shared`. It scans for raw PII and throws in
dev, which is how you find a leak in your own time rather than on stage. `pnpm check`
enforces this.

**No site-specific selectors.** Not one. Skrim has to work on websites nobody on this
team has seen (brief §4.6). If your code contains `.checkout-button` or `#login-form`, it will
fail on the day no matter how well the demo went.

**Do not implement a second DOM extractor.** WS2 owns the canonical screen graph. WS1
consumes its graph and keeps only the element references needed to execute actions.

**Redact before it leaves the client.** Anything read from the DOM is real user data until
the PII pipeline has tokenised it. The content script sends raw elements to the side panel,
which redacts every page view against the task's vault (`lib/agent/redact.ts`) before
planning, display or anything else. The last line of defence is `assertOutboundSafe()` from
`@skrim/schema`, called in the one place that makes the network request
(`lib/agent/server-planner.ts`).

Tokens are swapped for real values only at the moment of typing, by the loop, from the
vault. The content script refuses any value that still contains a token.

## Writing for both browsers

Write for Chrome's constraints; Firefox is strictly more permissive. Branch with
`import.meta.env.FIREFOX` only where the platforms genuinely differ (opening the side panel,
the offscreen document). Never fork a whole module per browser.

```powershell
pnpm dev              # chrome
pnpm dev:firefox
```

## Tests

Put tests next to the code as `lib/**/*.test.ts`, using Node's built-in `node:test` and
`node:assert/strict`. No Vitest, no Jest: CI runs `node --import tsx --test "lib/**/*.test.ts"`,
so a test written for another runner, or placed outside `lib/`, silently never runs.

Code that needs a DOM is tested against happy-dom (`GlobalRegistrator.register()`; see
`lib/agent/loop.test.ts`). happy-dom has no layout, so stub `getBoundingClientRect`, or every
element is invisible to the extractor. `pnpm test:agent` runs the fixture pages through the
whole loop against a real server.

## Before you open a PR

```powershell
pnpm verify           # from the repo root: invariants + typecheck + tests
```
