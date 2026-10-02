# apps/dashboard — the demo instrument

**Workstream 6. This is not decoration.** It is how 40% of the rubric becomes visible to a
judge, and it is on a projector for the entire demo.

## What it renders

**Split screen.** The real page on the left. On the right, a live render of *exactly what
the server receives* — faces blurred, account numbers tokenised, password fields masked,
updating every cycle. Judges watch redaction happen continuously rather than being told it
happened once (brief §9.1).

**The resource panel, always on.** Model footprint, per-stage inference milliseconds, memory,
end-to-end round trip, which backend actually bound (WebGPU or WASM). That is 35% of the
rubric sitting in the corner of the screen for the whole demo (brief §9.7).

**The wire view.** The actual outgoing request body, pretty-printed, with tokens highlighted.
Beat 4 is opening devtools and showing this is real — the panel should match what devtools
shows, because it is the same payload.

## The rules

**It receives, it does not compute.** The dashboard imports `@skrim/schema` for types and
renders what the extension sends it. No detection logic, no duplicate redaction — if the
dashboard redacts anything itself, it is showing a lie rather than the truth.

**It only ever sees the redacted graph.** Never wire it to the vault. Never send it raw
values so it can show a "before". The before is the real page on the left half of the screen;
that is the entire point of the split.

**Design for a projector at the back of a room.** Large type, high contrast, no subtle
greys. A judge four metres away has to read the token strings.

**Never break the demo.** This app must degrade rather than crash. If a message arrives
malformed, render the last good state and a small warning — a white screen mid-demo costs
more than any missing feature.

## How the data gets here

The side panel sends it; nothing goes through the server.

1. `lib/agent/dashboard-feed.ts` (extension) wraps the planner, so it sees each request
   exactly as sent and the reply, and gets the loop's events through one hook in the side
   panel's `App.tsx`. It checks every message against `DashboardMessageSchema`
   (`packages/schema/src/dashboard.ts`) and scans it for raw personal data before sending.
2. `entrypoints/sidepanel/feed-instance.ts` finds the tab whose address starts with the
   dashboard's (`WXT_DASHBOARD_URL`, default `http://localhost:5173`), sends a heartbeat every
   2 s, and supplies the model sizes (`public/models/manifest.json`, written by
   `pnpm models:fetch`) and the planner's name (the server's `/`).
3. The extension's content script, on the dashboard's page only, passes each message to the
   page with `window.postMessage`; `src/App.tsx` validates it again and renders it.

Run it with `pnpm --filter @skrim/dashboard dev`, then open http://localhost:5173 in the same
Chrome window as the extension. Testing steps: [`docs/testing.md`](../../docs/testing.md)
section 7.

## Why this is separate from apps/web

`apps/web` is the public landing page and deploys to Vercel. This is a live instrument with
an open connection to the extension. Separate apps so a broken landing-page build has zero
ability to take the demo down.
