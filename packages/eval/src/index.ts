// Detection recall and precision, redaction IoU, over-redaction and timing,
// scored against the annotated fixtures in fixtures/. The numbers come from
// the real extension in Chromium (src/browser.ts, `pnpm eval`).
export { hiddenSpans, type HiddenSpan } from "./align.ts";
export { LOCATIONS, loadGroundTruth, parseGroundTruth, type GroundTruth, type Location, type PiiItem } from "./ground-truth.ts";
export type { PageTexts, Reading } from "./reading.ts";
export { renderReport } from "./report.ts";
export { scoreFixture, summarise, type FixtureScore, type ItemResult, type Totals } from "./score.ts";
