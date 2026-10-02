/**
 * Recovers what redaction hid, from a text and its redacted form. Redaction
 * only ever replaces spans of the text with tokens, so the literal parts of
 * the redacted text appear in the raw text in order, and the gaps between
 * them are the hidden spans.
 */

export interface HiddenSpan {
  start: number;
  end: number;
  /** The token categories that replaced it: two adjacent tokens share one span. */
  categories: string[];
}

const TOKEN = /<PII:([A-Z_]+):\d+>/g;

/** The hidden spans of `raw`, or null when `redacted` is not a redaction of it. */
export function hiddenSpans(raw: string, redacted: string): HiddenSpan[] | null {
  const spans: HiddenSpan[] = [];
  let rawAt = 0;
  let redactedAt = 0;
  let open: HiddenSpan | null = null;

  for (const match of redacted.matchAll(TOKEN)) {
    const literal = redacted.slice(redactedAt, match.index);
    if (open === null) {
      if (!raw.startsWith(literal, rawAt)) return null;
      rawAt += literal.length;
      open = { start: rawAt, end: rawAt, categories: [match[1]!] };
    } else if (literal === "") {
      open.categories.push(match[1]!);
    } else {
      // A hidden span is never empty, so the literal starts at least one character on.
      const at = raw.indexOf(literal, open.start + 1);
      if (at < 0) return null;
      spans.push({ ...open, end: at });
      rawAt = at + literal.length;
      open = { start: rawAt, end: rawAt, categories: [match[1]!] };
    }
    redactedAt = match.index + match[0].length;
  }

  const tail = redacted.slice(redactedAt);
  if (open === null) return raw.slice(rawAt) === tail ? spans : null;
  if (!raw.endsWith(tail) || raw.length - tail.length <= open.start) return null;
  spans.push({ ...open, end: raw.length - tail.length });
  return spans;
}
