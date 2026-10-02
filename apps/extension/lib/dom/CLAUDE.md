# lib/dom — the element graph

**Workstream 2.** Turns a live page into `ScreenElement[]` from `@skrim/schema`.

## What this is

A walk of the accessibility tree and DOM producing one flat, id-addressed graph of
everything interactable and everything readable. This is the *primary* transport format —
Brief §4.1 asks for the structure of the screen, not pixels. Vision fills
the gaps; the DOM does the bulk.

## The rules

**No site-specific selectors. Ever.** Skrim has to work on unseen websites (brief §4.6). Route
everything through roles, accessible names, and geometry. `.checkout-btn` is an automatic
PR rejection.

**Ids must be stable within a cycle and meaningful across one.** The server sends back
`{ action: "click", target: "e17" }`, and if e17 means something different by the time we
execute, we click the wrong thing on stage. Assign ids in one place, deterministically.

**Redact during construction, not before send.** By the time a `ScreenElement` exists, its
`label` and `value` hold safe text or PII tokens. Do not build a raw graph and clean it
later — something will always slip past.

**Everything gets `source`.** `"dom"`, `"vision"`, or `"fused"`. The 25% accuracy criterion
partly rests on showing that vision earns its place, and we cannot demonstrate that without
provenance on every node.

## Getting the accessible name right

This is most of the value of this module. In priority order: `aria-label`, `aria-labelledby`,
an associated `<label>`, `placeholder`, text content, `title`, `alt`. A button whose only
identity is an SVG icon has no accessible name — that is precisely the case the vision
model exists for. Mark it and move on rather than guessing.

## What to skip

Invisible elements, zero-size boxes, `aria-hidden`, and anything off-screen unless it is
scrollable into view. Every element you include costs prompt tokens and therefore latency,
which is 15% of the rubric. A graph of 40 meaningful elements beats one of 400.

## What you cannot see, and must hand to vision

- `<canvas>` — one opaque box; an entire app can live inside it
- cross-origin `<iframe>` — invisible by browser security design
- `<img>`, embedded PDFs, pasted screenshots — pixels, no text
- faces — never in the DOM at all

Emit these as elements with the right role and let `lib/vision` fill them in.
