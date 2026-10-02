# lib/pii — detection and redaction

**Workstream 3.** Worth **40% of the rubric** across two criteria: recall/precision of
detection, and precision of redaction.

## Three detectors, fused

| Detector | Catches | Cost |
|---|---|---|
| Regex bank (`regex.ts`) | email, phone, card, PAN, Aadhaar, account numbers | free, exact |
| GLiNER NER (`gliner*.ts`, `ner-*.ts`) | names and addresses in free text — what regex cannot | 45 MB model + 14 MB ONNX Runtime; ~5 ms a text |
| BlazeFace (`public/models/face/`) | faces in images and video | 224 KB; not wired |

Plus `type="password"` and form-field `type`/`autocomplete` hints from the DOM, which are free
and nearly certain.

## How GLiNER runs

`knowledgator/gliner-pii-edge-v1.0`, the token-level variant, quantised to uint8. There is
no Transformers.js pipeline for GLiNER, so `gliner-model.ts` does the pre- and
post-processing by hand (following the reference `TokenProcessor` and `TokenDecoder`), on
`onnxruntime-web/wasm` in the side panel (`ner-browser.ts`) and `onnxruntime-node` in tests
and scripts (`ner-node.ts`), with `@huggingface/tokenizers`.

Measured, and fixed in `gliner.ts`:
- Labels `person` and `address`, threshold **0.6**. At 0.5 it called "Friday" an address.
- One text per batch row. Packing many texts into one sequence lost most names.
- Misses: a name inside a long mixed sentence ("Hi, I'm Suparno. Email ..."), and a UK
  postcode after the street. Organisations are not asked for on purpose: shop and brand
  names are what the planner navigates by.

The loop scans each page view's texts before redacting it, once per text per task. If the
model cannot load, the task continues on the regex layer with a visible warning
(fails open; see CLAUDE.md "Open findings").

Run the cheap ones first and only escalate. Most of the latency win in this project comes
from *not running a model* (brief §8), and that applies here as much as anywhere.

## The rules

**Report confidence honestly.** Detection is statistical. Recall will not be 100%, which is
exactly why two criteria are precision measurements rather than pass/fail. A team claiming
perfection gets taken apart in questioning; a team with numbers and known failure modes does
not.

**Over-redaction is scored too.** "Hiding it precisely" means removing PII *without
destroying useful context*. Blacking out the whole page scores zero. If you redact the label
"Email" as well as the value, the server can no longer reason about the form.

**Tokenise, never destroy.** Every detection becomes a `PiiToken` via the vault. Use
`formatPiiToken()` from `@skrim/schema`.

**No values in logs.** Use `log` from `@skrim/shared`. It throws in dev if you try.

## Calibrating the regex bank

Indian formats matter here — Aadhaar (12 digits), PAN (`ABCDE1234F`), IFSC, UPI ids. But
bare 12-digit and 10-digit patterns collide with order numbers and product codes constantly.
Prefer patterns with structure (PAN, IFSC, UPI) and use context — a nearby label saying
"Aadhaar" is worth more than the digit count.

Note the deliberately narrow patterns in `@skrim/schema`'s `guard.ts`: that is the
last-resort tripwire and must never false-positive. Your detector is allowed to be more
aggressive, because a false positive there costs a little context rather than the demo.

## You own a scored deliverable

`packages/eval` measures this module against `fixtures/`. Recall, precision, redaction IoU,
and over-redaction rate are numbers we have to put on a slide. Coordinate with workstream 5
early — the fixtures need to exist before the numbers can.

Also open: **GLiNER quint8 vs fp16**, accuracy per millisecond. Measure with
`pnpm demo:pii`-style runs through `ner-node.ts` once fixtures have ground truth. That comparison is the
client half of the tradeoff curve the brief plans for (§9.6). Both variants are
available; only quint8 is fetched today.
