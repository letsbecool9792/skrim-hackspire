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

## Why this is separate from apps/web

`apps/web` is the public landing page and deploys to Vercel. This is a live instrument with
an open connection to the extension. Separate apps so a broken landing-page build has zero
ability to take the demo down.
