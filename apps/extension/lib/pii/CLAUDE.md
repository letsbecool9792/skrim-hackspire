# lib/pii — detection and redaction

**Workstream 3.** Worth **40% of the rubric** across two criteria: recall/precision of
detection, and precision of redaction.

## Three detectors, fused

| Detector | Catches | Cost |
|---|---|---|
| Regex bank | email, phone, card, PAN, Aadhaar, account numbers | free, exact |
| GLiNER NER (`public/models/gliner-pii/`) | names, addresses, employers — what regex cannot | ~45 MB, WebGPU |
| BlazeFace (`public/models/face/`) | faces in images and video | 224 KB |

Plus `type="password"` and friends from the DOM, which are free and certain.

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

Also open: **GLiNER quint8 vs fp16**, accuracy per millisecond. That comparison is the
client half of the tradeoff curve the brief plans for (§9.6). Both variants are
available; only quint8 is fetched today.
