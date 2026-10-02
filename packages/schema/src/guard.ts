import type { ScreenGraph } from "./graph.js";

/**
 * THE TRIPWIRE.
 *
 * Every outbound request must pass through assertOutboundSafe() before it
 * touches the network. This is not the PII detector - that lives in the
 * extension and is statistical. This is a last-resort structural check that
 * turns "we leaked personal data on stage" into "a loud exception in dev".
 *
 * It is deliberately narrow. Only patterns with near-zero false-positive rates
 * are in here, because this function THROWS: a false positive breaks the demo
 * just as thoroughly as a leak would. Aadhaar (12 bare digits) and generic
 * 10-digit phone numbers are absent for exactly that reason - they collide with
 * order numbers and product codes constantly.
 *
 * Catching everything is the detector's job. Catching the unmistakable is this
 * function's job, and it must never cry wolf.
 */

export interface RawPiiFinding {
  kind: "EMAIL" | "CARD" | "PAN" | "INTL_PHONE";
  /** Where in the serialised payload, for debugging. Never the value itself. */
  atIndex: number;
  /** Length only. We do not put the offending value in an error message - that
   *  is how PII ends up in a crash report (brief section 7). */
  length: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Indian PAN: five letters, four digits, one letter. Highly distinctive. */
const PAN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
/** E.164-ish: a + followed by 11-15 digits, separators allowed. */
const INTL_PHONE = /\+\d[\d\s-]{9,17}\d/g;
/** 13-19 digit runs, validated with Luhn below to kill false positives. */
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Scan a serialised payload for unmistakable raw PII. Returns findings rather
 * than throwing, so the dashboard can render "outbound check: clean" live.
 */
export function scanForRawPii(serialised: string): RawPiiFinding[] {
  const findings: RawPiiFinding[] = [];

  for (const m of serialised.matchAll(EMAIL)) {
    findings.push({ kind: "EMAIL", atIndex: m.index, length: m[0].length });
  }
  for (const m of serialised.matchAll(PAN)) {
    findings.push({ kind: "PAN", atIndex: m.index, length: m[0].length });
  }
  for (const m of serialised.matchAll(INTL_PHONE)) {
    findings.push({ kind: "INTL_PHONE", atIndex: m.index, length: m[0].length });
  }
  for (const m of serialised.matchAll(CARD_CANDIDATE)) {
    const digits = m[0].replace(/[^\d]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) {
      findings.push({ kind: "CARD", atIndex: m.index, length: m[0].length });
    }
  }

  return findings;
}

/**
 * Throw if a graph about to be sent still contains raw PII.
 *
 * Call this in the ONE place that performs the network request. Do not scatter
 * it around, and do not catch and ignore it - if this fires, redaction has a
 * bug and the correct response is to stop, not to continue quietly.
 */
export function assertOutboundSafe(graph: ScreenGraph): void {
  const findings = scanForRawPii(JSON.stringify(graph));
  if (findings.length === 0) return;

  const summary = findings.map((f) => f.kind).join(", ");
  throw new Error(
    `Outbound payload contains unredacted PII (${findings.length}: ${summary}). ` +
      `Refusing to send. This is a redaction bug - fix the detector, do not ` +
      `bypass this check. Values are intentionally omitted from this message.`
  );
}
