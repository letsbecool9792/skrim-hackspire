# lib/capture — screenshots and change detection

**Workstream 1.** Decides *when* the expensive pipeline runs. This is where most of the
latency score is won or lost.

## The constraint you cannot engineer around

`tabs.captureVisibleTab` is hard-capped at roughly **two calls per second**, and there is no
way to raise it. Not a tuning knob — a ceiling. Design around it rather than fighting it.

## The actual insight

**Most of the latency win comes from not running the model** (brief §8). A pipeline that
runs full inference every frame is both slower and worse than one that runs it only when the
screen has materially changed.

So: drive the loop off a `MutationObserver` plus a cheap frame diff, and escalate to the
vision pass only when something meaningful moved. A caret blinking, a clock ticking, or an
animated banner must not trigger a model run.

Tune the diff threshold against real pages and record the numbers — "we skipped 80% of
inference passes" is a resource-panel line that directly serves two scored criteria.

## The rules

**No screenshot touches disk.** Capture, infer, discard the buffer in the same cycle. No
`chrome.storage`, no blob URLs left alive, no caching "just for debugging".

**Redact the bitmap before it can be sent.** If a screenshot goes to the server at all, the
faces and sensitive regions are painted over first, and a `RedactionManifest` describes what
was covered so the server is not staring at an unexplained black rectangle.

**Pixels are the fallback, not the default.** Brief §4.1 asks for structural abstraction as the
primary transport. Send a screenshot only when the DOM genuinely cannot answer the question —
canvas, cross-origin iframe, embedded document.

WS1 owns capture mechanics, cooldowns, and cheap change gating. WS2 owns visual
interpretation and fusion. WS1 must not inspect pixels for UI meaning.

## Time everything

Use `timed()` from `@skrim/shared` with the stage names it defines. The resource panel and
the tradeoff-curve slide both read from that data, and neither exists if the instrumentation
was skipped.
