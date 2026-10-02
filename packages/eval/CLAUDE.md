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

Do **not** report numbers from the detection code run in Node. That measures a different
code path than the one we demo — different runtime, different backend, different device
selection. The rubric scores the shipped thing. So do we.

## How it runs

| Command | What | Use |
|---|---|---|
| `pnpm eval` | `src/browser.ts`: builds the eval extension (`wxt build --mode eval`), loads it into Playwright's Chromium, serves the fixtures on two origins, and asks the side panel's `window.__skrimEval` to read each one | **The numbers to report.** Once first: `pnpm --filter @skrim/eval exec playwright install chromium` |
| `pnpm eval:node` | `apps/extension/scripts/eval-node.ts`: the same `readPage()` in happy-dom, GLiNER on onnxruntime-node | A quick check while changing detection, and a check that ground truth matches its page. Not for the slide |

Both read a page through `apps/extension/lib/agent/read-page.ts`, the function the agent
loop calls every step, and score with `src/score.ts`. The eval hook exists only in the eval
build; `main.tsx` imports it behind a constant condition, and production builds do not
contain it.

Scoring recovers what was hidden by lining each redacted text up with the original
(`src/align.ts`). An item counts as caught only if every place it appears is hidden
completely. Items that appear in no text at all (a canvas, an image, a cross-origin frame)
are "not seen" and reported apart: those are vision's. An item whose `where` is a canvas,
an image or an iframe is found allowing OCR's slips around dots, commas and spaces
("karan mehta@example.com" for "karan.mehta@example.com"): what is scored is whether it was
hidden. `pnpm eval -- --show-text <page>` prints a page as it was read and as it was sent.

## Fixtures

`fixtures/pages/` — synthetic pages with PII in known places (22 so far).
`fixtures/ground-truth/` — one JSON per page: `pii` (category, exact value, where it sits)
and `notPii` (near-misses that must stay readable).

**PII means what Skrim promises to hide:** the user's data and the people in their private
life. Public figures, shops, organisations and business contact details are not PII: they go
in `notPii`, because hiding them is over-redaction. A value must appear in the page's text
exactly as written in the JSON; the report lists near-misses it cannot find.

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

Results go to `results/` (gitignored); `pnpm eval -- --save` also writes `SUMMARY.md`, the
committed summary for the slide.
