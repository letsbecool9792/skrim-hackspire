import { hiddenSpans, type HiddenSpan } from "./align.ts";
import type { GroundTruth, Location, PiiItem } from "./ground-truth.ts";
import type { PageTexts, Reading } from "./reading.ts";

/**
 * Scores one reading of a fixture against its ground truth.
 *
 * An item is caught when every place it appears in the page's text is hidden
 * completely: a name hidden in the header but readable in the footer reached
 * the server. Items that appear nowhere in the text (inside a canvas, an
 * image, a cross-origin frame) are "not seen": the DOM never had them, so only
 * vision could catch them.
 */

export interface ItemResult {
  item: PiiItem;
  /** Found in the page's text at all. */
  seen: boolean;
  /** Every occurrence completely hidden. */
  caught: boolean;
  /** Some of it hidden, some readable. */
  partial: boolean;
  /** Replaced by a token of the right category. */
  categoryRight: boolean;
  /** Mean overlap between the true span and what was hidden around it, 0-1. */
  iou: number;
}

export interface FixtureScore {
  page: string;
  about: string;
  personal: boolean;
  nameModel: Reading["nameModel"];
  items: ItemResult[];
  /** Hidden text that is not PII. Synthetic fixtures, so the text itself is shown. */
  falsePositives: { text: string; categories: string[] }[];
  hiddenSpans: number;
  /** Near-misses (notPii) found in the text, and which of them were hidden. */
  nearMisses: { value: string; seen: boolean; hidden: boolean }[];
  /** Characters outside any PII that were hidden, and all characters outside PII. */
  overRedactedChars: number;
  nonPiiChars: number;
  /** Texts whose redaction could not be lined up with the original. Should be 0. */
  unaligned: number;
  timings: Reading["timings"];
  beyondView: Reading["beyondView"];
  facesFound?: number;
  facesExpected?: number;
}

interface Pair {
  raw: string;
  spans: HiddenSpan[];
}

function pairs(raw: PageTexts, redacted: PageTexts): { pairs: Pair[]; unaligned: number } {
  const texts: [string | undefined, string | undefined][] = [[raw.title, redacted.title]];
  raw.elements.forEach((element, index) => {
    const other = redacted.elements[index] ?? {};
    texts.push([element.label, other.label], [element.value, other.value], [element.hint, other.hint]);
  });
  let unaligned = 0;
  const result: Pair[] = [];
  for (const [rawText, redactedText] of texts) {
    if (!rawText) continue;
    const spans = hiddenSpans(rawText, redactedText ?? "");
    if (spans === null) {
      // Treat it as wholly hidden, and count it: the report shows the number.
      unaligned++;
      result.push({ raw: rawText, spans: [{ start: 0, end: rawText.length, categories: ["?"] }] });
    } else {
      result.push({ raw: rawText, spans });
    }
  }
  return { pairs: result, unaligned };
}

interface Range { start: number; end: number }

/** Where a value can only be read from pixels, by OCR. */
const PIXEL_PLACES = new Set(["canvas", "image", "iframe"]);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where `value` appears in `text`. A value read from pixels is matched allowing
 * OCR's usual slips around separators: Tesseract read the iframe fixture's
 * "karan.mehta@example.com" as "karan mehta@example.com". What is scored is
 * whether that text was hidden, not whether OCR spelled it right.
 */
function occurrences(text: string, value: string, fromPixels = false): Range[] {
  const found: Range[] = [];
  if (!fromPixels) {
    for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) found.push({ start: at, end: at + value.length });
    return found;
  }
  const pattern = new RegExp([...value].map((char) => (/[.,\s-]/.test(char) ? "[.,\\s-]{0,2}" : escapeRegExp(char))).join(""), "gi");
  for (const match of text.matchAll(pattern)) {
    if (match[0].length > 0) found.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return found;
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

export function scoreFixture(truth: GroundTruth, reading: Reading): FixtureScore {
  const { pairs: texts, unaligned } = pairs(reading.raw, reading.redacted);
  // Every place PII sits, per text, to tell true from false positives.
  const piiRanges = texts.map((pair) => truth.pii.flatMap((item) => occurrences(pair.raw, item.value, PIXEL_PLACES.has(item.where))));

  const items = truth.pii.map((item): ItemResult => {
    let seen = false;
    let caught = true;
    let anyHidden = false;
    let categoryRight = true;
    const ious: number[] = [];
    texts.forEach((pair) => {
      for (const truthSpan of occurrences(pair.raw, item.value, PIXEL_PLACES.has(item.where))) {
        seen = true;
        const touching = pair.spans.filter((span) => overlap(span, truthSpan) > 0);
        const covered = touching.reduce((sum, span) => sum + overlap(span, truthSpan), 0);
        if (covered < truthSpan.end - truthSpan.start) caught = false;
        if (covered > 0) anyHidden = true;
        if (!touching.some((span) => span.categories.includes(item.category))) categoryRight = false;
        const union = touching.reduce((low, span) => ({ start: Math.min(low.start, span.start), end: Math.max(low.end, span.end) }), truthSpan);
        ious.push(covered / (union.end - union.start));
      }
    });
    caught &&= seen;
    return {
      item,
      seen,
      caught,
      partial: seen && anyHidden && !caught,
      categoryRight: caught && categoryRight,
      iou: ious.length > 0 ? ious.reduce((a, b) => a + b, 0) / ious.length : 0,
    };
  });

  const falsePositives: FixtureScore["falsePositives"] = [];
  let hiddenCount = 0;
  let overRedactedChars = 0;
  let nonPiiChars = 0;
  texts.forEach((pair, index) => {
    const ranges = piiRanges[index]!;
    for (const span of pair.spans) {
      hiddenCount++;
      if (!ranges.some((range) => overlap(range, span) > 0)) falsePositives.push({ text: pair.raw.slice(span.start, span.end), categories: span.categories });
    }
    for (let at = 0; at < pair.raw.length; at++) {
      const inPii = ranges.some((range) => at >= range.start && at < range.end);
      if (inPii) continue;
      nonPiiChars++;
      if (pair.spans.some((span) => at >= span.start && at < span.end)) overRedactedChars++;
    }
  });

  const nearMisses = truth.notPii.map((value) => {
    let seen = false;
    let hidden = false;
    for (const pair of texts) {
      for (const range of occurrences(pair.raw, value)) {
        seen = true;
        if (pair.spans.some((span) => overlap(span, range) > 0)) hidden = true;
      }
    }
    return { value, seen, hidden };
  });

  return {
    page: truth.page,
    about: truth.about,
    personal: reading.personal,
    nameModel: reading.nameModel,
    items,
    falsePositives,
    hiddenSpans: hiddenCount,
    nearMisses,
    overRedactedChars,
    nonPiiChars,
    unaligned,
    timings: reading.timings,
    beyondView: reading.beyondView,
    facesFound: reading.faces,
    facesExpected: truth.faces,
  };
}

export interface Totals {
  fixtures: number;
  pii: number;
  /** Items in the DOM text; the rest need vision. */
  seen: number;
  caught: number;
  partial: number;
  categoryRight: number;
  /** Caught / all PII, and caught / PII in the DOM text. */
  recall: number;
  recallInText: number;
  /** Hidden spans that were PII / all hidden spans. */
  precision: number;
  /** Mean IoU over the items in the text. */
  iou: number;
  nearMisses: number;
  nearMissesHidden: number;
  /** Share of non-PII characters hidden. */
  overRedaction: number;
  unaligned: number;
  byCategory: Record<string, { pii: number; caught: number }>;
  byLocation: Partial<Record<Location, { pii: number; caught: number }>>;
  facesFound: number;
  facesExpected: number;
  /** Median milliseconds per reading, per stage. */
  medianMs: { observe: number; vision: number; names: number; redact: number };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const ratio = (part: number, whole: number) => (whole === 0 ? 1 : part / whole);

export function summarise(scores: FixtureScore[]): Totals {
  const items = scores.flatMap((score) => score.items);
  const seen = items.filter((item) => item.seen);
  const caught = items.filter((item) => item.caught);
  const spans = scores.reduce((sum, score) => sum + score.hiddenSpans, 0);
  const falsePositives = scores.reduce((sum, score) => sum + score.falsePositives.length, 0);
  const nearMisses = scores.flatMap((score) => score.nearMisses).filter((miss) => miss.seen);
  const byCategory: Totals["byCategory"] = {};
  const byLocation: Totals["byLocation"] = {};
  for (const result of items) {
    const category = (byCategory[result.item.category] ??= { pii: 0, caught: 0 });
    const location = (byLocation[result.item.where] ??= { pii: 0, caught: 0 });
    category.pii++;
    location.pii++;
    if (result.caught) {
      category.caught++;
      location.caught++;
    }
  }
  return {
    fixtures: scores.length,
    pii: items.length,
    seen: seen.length,
    caught: caught.length,
    partial: items.filter((item) => item.partial).length,
    categoryRight: items.filter((item) => item.categoryRight).length,
    recall: ratio(caught.length, items.length),
    recallInText: ratio(caught.length, seen.length),
    precision: ratio(spans - falsePositives, spans),
    iou: seen.length === 0 ? 1 : seen.reduce((sum, item) => sum + item.iou, 0) / seen.length,
    nearMisses: nearMisses.length,
    nearMissesHidden: nearMisses.filter((miss) => miss.hidden).length,
    overRedaction:
      scores.reduce((sum, score) => sum + score.overRedactedChars, 0) /
      Math.max(1, scores.reduce((sum, score) => sum + score.nonPiiChars, 0)),
    unaligned: scores.reduce((sum, score) => sum + score.unaligned, 0),
    byCategory,
    byLocation,
    facesFound: scores.reduce((sum, score) => sum + (score.facesFound ?? 0), 0),
    facesExpected: scores.reduce((sum, score) => sum + (score.facesExpected ?? 0), 0),
    medianMs: {
      observe: median(scores.map((score) => score.timings.observeMs)),
      vision: median(scores.map((score) => score.timings.visionMs)),
      names: median(scores.map((score) => score.timings.namesMs)),
      redact: median(scores.map((score) => score.timings.redactMs)),
    },
  };
}
