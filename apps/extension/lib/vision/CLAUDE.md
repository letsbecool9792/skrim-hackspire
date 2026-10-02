# lib/vision — local model inference

**Workstream 2 and 3.** Everything that runs a neural network in the browser.

## This code runs in the offscreen document

On Chrome, model inference **cannot** happen in the background service worker — WebGPU and
WASM are both unavailable there ([transformers.js#787](https://github.com/huggingface/transformers.js/issues/787)).
It goes in `entrypoints/offscreen/`, which the background worker talks to by message.

Firefox's event page has DOM access and needs no equivalent, but write for the Chrome path
and let Firefox use it too. One code path.

## Models on disk

`pnpm models:fetch` populates `public/models/`. Currently **63.6 MB**:

| Path | What | Runtime |
|---|---|---|
| `gliner-pii/` | text PII NER, uint8 | Transformers.js |
| `face/` | BlazeFace short-range | MediaPipe tasks-vision |
| `mediapipe-wasm/` | MediaPipe runtime, SIMD only | — |
| `tesseract-core/`, `tesseract/` | OCR engine + English data | tesseract.js |
| `ui-detect/` | OmniParser icon detector | raw onnxruntime-web (not exported yet) |

**Load models from `public/models/`, never from a CDN.** MV3's CSP blocks remote WASM, and
the air-gap demo (beat 8) requires the extension to work with no network at all.

**Resource use is 20% of the rubric.** Adding a model has a real cost. Lazy-load: OCR should
not initialise until something actually needs text out of pixels.

## Why vision exists at all

A judge will reasonably ask why we did not just run a regex over the DOM. The answer has to
be demonstrable (brief §9.5):

- `<canvas>` is one opaque box — an entire app can be drawn inside it
- cross-origin `<iframe>` is invisible to us by browser security design
- scanned IDs, embedded PDFs, pasted screenshots are pixels with no text
- a face is never in the DOM

Build for those cases specifically. Vision that only re-detects buttons the DOM already
found is 12 MB of nothing.

## Device selection

Try WebGPU, fall back to WASM. Both target browsers have WebGPU on Windows (Chrome 152,
Firefox 149 — Firefox since 141), so WebGPU is the normal path, not the exotic one.

Watch for **silent** WASM fallback: ONNX Runtime Web drops unsupported operators to WASM
without an error, and the speedup vanishes with no warning. Log which backend actually
bound, and put it on the resource panel.
