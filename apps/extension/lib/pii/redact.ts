import { type PiiCategory } from "@skrim/schema";

import { type PiiCandidate, type PiiMatch, findRegexCandidates, tokenise } from "./regex.js";
import { TokenVault } from "../vault/vault.js";

export function detectPasswordValue(value: string, vault: TokenVault): PiiMatch | null {
  if (value.length === 0) return null;
  return { token: vault.set("OTHER", value), category: "OTHER", source: "dom-type", confidence: 1, text: value, start: 0, end: value.length };
}

export function redactMatches(text: string, matches: PiiMatch[]): string {
  return [...matches].sort((left, right) => right.start - left.start).reduce((redacted, match) => redacted.slice(0, match.start) + match.token + redacted.slice(match.end), text);
}

export interface RedactedDomData {
  label?: string;
  value?: string;
  detections: PiiMatch[];
}

/** Keeps the earliest, then longest, of any overlapping candidates. */
function resolveOverlaps(candidates: PiiCandidate[]): PiiCandidate[] {
  const ordered = [...candidates].sort((left, right) => left.start - right.start || right.end - left.end);
  const accepted: PiiCandidate[] = [];
  for (const candidate of ordered) {
    if (accepted.some((match) => candidate.start < match.end && candidate.end > match.start)) continue;
    accepted.push(candidate);
  }
  return accepted;
}

/**
 * The private names and addresses in a text, looked up by the exact text. The
 * model is async and runs before each page view is redacted
 * (lib/agent/private-names.ts); redaction itself stays synchronous.
 */
export type NameLookup = (text: string) => PiiCandidate[];

/**
 * Detects PII in `text`. `context` is text that describes it, such as a form
 * field's label: "123456789012" alone is not PII, but it is after "Aadhaar".
 * Only matches inside `text` are returned.
 */
export function detectText(text: string, vault: TokenVault, context?: string, names?: NameLookup): PiiMatch[] {
  const found = names?.(text) ?? [];
  if (!context) return tokenise(withWholeAddresses(text, resolveOverlaps([...findRegexCandidates(text), ...found])), vault);
  const prefix = `${context}: `;
  const inText = findRegexCandidates(prefix + text)
    .filter((candidate) => candidate.start >= prefix.length)
    .map((candidate) => ({ ...candidate, start: candidate.start - prefix.length, end: candidate.end - prefix.length }));
  return tokenise(withWholeAddresses(text, resolveOverlaps([...inText, ...found])), vault);
}

/** Short parts separated by commas, from the start of the text: "Flat 4B, Lake View Apartments, ". */
const ADDRESS_PARTS_BEFORE = /^\s*(?:[^,.;:!?]{1,40},\s*)+$/;

/**
 * GLiNER often finds the end of an address and not its first parts: it found
 * "Koramangala, Bengaluru 560034" in "Flat 4B, Lake View Apartments,
 * Koramangala, Bengaluru 560034". When all that comes
 * before an address is short comma-separated parts, with nothing else found
 * among them, they are the rest of it.
 */
function withWholeAddresses(text: string, candidates: PiiCandidate[]): PiiCandidate[] {
  return candidates.map((candidate) => {
    if (candidate.category !== "ADDRESS" || candidate.start === 0) return candidate;
    const before = text.slice(0, candidate.start);
    if (!ADDRESS_PARTS_BEFORE.test(before) || candidates.some((other) => other.end <= candidate.start)) return candidate;
    const start = before.search(/\S/);
    return { ...candidate, start, text: text.slice(start, candidate.end) };
  });
}

/**
 * What a form field says it holds, from its type and autocomplete tokens.
 * A name field is the only way names get caught until GLiNER is wired in.
 */
const AUTOCOMPLETE_CATEGORIES: Record<string, PiiCategory> = {
  name: "NAME",
  "given-name": "NAME",
  "additional-name": "NAME",
  "family-name": "NAME",
  nickname: "NAME",
  "cc-name": "NAME",
  username: "OTHER",
  email: "EMAIL",
  tel: "PHONE",
  "tel-national": "PHONE",
  "tel-local": "PHONE",
  "street-address": "ADDRESS",
  "address-line1": "ADDRESS",
  "address-line2": "ADDRESS",
  "address-line3": "ADDRESS",
  "postal-code": "ADDRESS",
  "cc-number": "CARD",
  "cc-csc": "CARD",
  bday: "DOB",
  "one-time-code": "OTHER",
};

const INPUT_TYPE_CATEGORIES: Record<string, PiiCategory> = {
  email: "EMAIL",
  tel: "PHONE",
};

export function fieldCategory(inputType?: string, autocomplete?: string): PiiCategory | undefined {
  for (const token of autocomplete?.toLowerCase().split(/\s+/) ?? []) {
    const category = AUTOCOMPLETE_CATEGORIES[token];
    if (category) return category;
  }
  return inputType ? INPUT_TYPE_CATEGORIES[inputType.toLowerCase()] : undefined;
}

export interface DomData {
  label?: string;
  value?: string;
  /**
   * The label of the element just before, when it may say what this one
   * holds: a <dt> for its <dd>, a <th> for its <td>. Only numbers that need a
   * label ("Aadhaar", "Date of birth", "Account number") use it.
   */
  context?: string;
  /** The input's `type` attribute. */
  inputType?: string;
  /** The input's `autocomplete` attribute. */
  autocomplete?: string;
}

export function redactDomData(data: DomData, vault: TokenVault, names?: NameLookup): RedactedDomData {
  const detections: PiiMatch[] = [];
  const redact = (text: string, matches: PiiMatch[]): string => {
    detections.push(...matches);
    return redactMatches(text, matches);
  };
  const labelMatches = data.label ? detectText(data.label, vault, data.context, names) : [];
  return {
    label: data.label === undefined ? undefined : redact(data.label, labelMatches),
    value: data.value === undefined ? undefined : redact(data.value, detectValue(data, vault, names)),
    detections,
  };
}

function detectValue(data: DomData, vault: TokenVault, names?: NameLookup): PiiMatch[] {
  const value = data.value;
  if (!value) return [];
  const isPassword = data.inputType === "password" || /\b(current|new)-password\b/.test(data.autocomplete ?? "");
  if (isPassword) {
    const match = detectPasswordValue(value, vault);
    return match ? [match] : [];
  }
  // The field says what it holds: a name, an address, a phone number written
  // without a country code. Trust it for the whole value. Matches inside it
  // are not enough: GLiNER found "3rd Cross, Indiranagar" in a street field
  // holding "221B, 3rd Cross, Indiranagar" and left "221B" readable.
  const category = fieldCategory(data.inputType, data.autocomplete);
  if (category && value.trim().length > 0) {
    return [{ token: vault.set(category, value), category, source: "dom-type", confidence: 0.9, text: value, start: 0, end: value.length }];
  }
  return detectText(value, vault, data.label, names);
}
