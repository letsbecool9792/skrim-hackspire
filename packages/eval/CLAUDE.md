# packages/eval — the measurement harness

**Workstream 5. This is a deliverable, not tooling.**

Two of the brief's five measures — **40% of the rubric** — are precision and recall numbers.
We cannot claim them without producing them. There is no partial credit for "our detection
is pretty good".

## What it measures

| Metric | Against |
|---|---|
| Detection recall | Did we find every PII instance in the fixture? |
| Detection precision | Did we flag things that were not PII? |
| Redaction IoU | Did the redacted region match the true region? |
| Over-redaction rate | How much non-PII context did we destroy? |
| End-to-end latency | Per stage and total, per the resource panel |

## The rule that shapes everything

**Run the real extension in a real browser, via Playwright.** Load the built extension into
Chromium, navigate to a fixture, and read out what it actually produced.

Do **not** import the detection code into Node and score it there. That measures a different
code path than the one we demo — different runtime, different backend, different device
selection. The rubric scores the shipped thing. So do we.

This is also why `onnxruntime-node` and `sharp` are left unbuilt in `pnpm-workspace.yaml`:
we never run inference in Node.

## Fixtures

`fixtures/pages/` — 30 to 50 synthetic pages with PII in known places.
`fixtures/ground-truth/` — annotations to score against.

Both are empty. They are the blocker on every number in this package, so build them first.

Cover the cases that separate us from a DOM-only team, because those are the ones that
count:

- ordinary forms and tables (the baseline)
- PII inside a `<canvas>`
- PII inside a cross-origin `<iframe>`
- a scanned ID card as an image
- a face in a photo
- **near-misses that are not PII** — order numbers, product codes, tracking IDs, dates.
  Over-redaction is scored, and this is the only way to catch it.

## Reporting

Report failure modes alongside the numbers. Detection is statistical; recall will not be
100%. The brief *expects* quantification, which is why two criteria are precision measurements
rather than pass/fail. A team claiming perfection gets taken apart in questioning. A team
that says "94% recall, and here is what we miss and why" does not.

Write results to `results/` (gitignored) and keep a committed summary for the slide.
