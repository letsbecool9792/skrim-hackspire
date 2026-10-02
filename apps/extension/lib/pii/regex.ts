import { type DetectionSource, type PiiCategory, type PiiDetection } from "@skrim/schema";

import { TokenVault } from "../vault/vault.js";

export interface PiiMatch extends PiiDetection {
  start: number;
  end: number;
}

/**
 * A match that has not been given a token yet. Finders produce candidates;
 * only the ones that survive overlap resolution are written to the vault.
 * Allocating first meant rejected candidates (a UPI reading of an email) still
 * took a token number and showed up in vault.stats().
 */
export type PiiCandidate = Omit<PiiMatch, "token" | "text"> & { text: string };

const EMAIL_PATTERN = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/gi;
// Up to three separators between digits: "+91  98765  43210" (double spaces)
// is still a phone number, and the outbound tripwire treats it as one.
const PHONE_PATTERN = /\+\d{1,3}(?:[\s.-]{0,3}\d){7,12}\b/g;
const CARD_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/g;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const IFSC_PATTERN = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi;
// UPI handles have no top-level domain (name@okaxis, not name@example.com), so
// the handle may not continue into a dot and more letters. A sentence-ending
// period is still fine.
const UPI_PATTERN = /\b[a-z0-9][a-z0-9._-]{1,80}@[a-z][a-z0-9]{1,30}(?![a-z0-9-]|\.[a-z0-9])/gi;
const AADHAAR_PATTERN = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
const ACCOUNT_NUMBER_PATTERN = /\b\d{8,18}\b/g;

const AADHAAR_CONTEXT = /aadhaar|aadhar|uidai/i;
const ACCOUNT_CONTEXT = /account(?:\s+number|\s+no\.?|#)?/i;

/** How far back a label may sit before the number it describes. */
const CONTEXT_WINDOW = 48;

function passesLuhn(value: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function findMatches(text: string, category: PiiCategory, source: DetectionSource, confidence: number, pattern: RegExp): PiiCandidate[] {
  return [...text.matchAll(pattern)].map((match) => {
    const value = match[0];
    const start = match.index ?? 0;
    return { category, source, confidence, text: value, start, end: start + value.length };
  });
}

/**
 * The words that label a number: the text just before it, cut at the previous
 * number. In "Aadhaar 1234 5678 9012, account number 123456789012", "Aadhaar"
 * labels the first number only; the second one's label is "account number".
 */
function labelBefore(text: string, start: number): string {
  const window = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const lastDigit = window.search(/\d\D*$/);
  return lastDigit === -1 ? window : window.slice(lastDigit + 1);
}

function findContextualNumbers(text: string, pattern: RegExp, contextPattern: RegExp, category: PiiCategory): PiiCandidate[] {
  return findMatches(text, category, "regex", 0.95, pattern)
    .filter((candidate) => contextPattern.test(labelBefore(text, candidate.start)));
}

/**
 * Luhn passes one number in ten, so it needs help: a 13-digit number starting
 * 978 or 979 is a book's ISBN (seven on Wikipedia's Alan Turing article
 * passed as cards), and no card number starts with 0. The same
 * rule is in @skrim/schema's tripwire, which must not fire on an ISBN.
 */
function looksLikeCard(digits: string): boolean {
  if (digits.startsWith("0")) return false;
  if (digits.length === 13 && /^97[89]/.test(digits)) return false;
  return passesLuhn(digits);
}

function findCards(text: string): PiiCandidate[] {
  return findMatches(text, "CARD", "regex", 1, CARD_PATTERN)
    .filter((candidate) => looksLikeCard(candidate.text.replace(/[ -]/g, "")));
}

/**
 * Every regex candidate in `text`, in detector priority order: when two
 * candidates cover exactly the same span, the earlier detector wins.
 */
export function findRegexCandidates(text: string): PiiCandidate[] {
  return [
    ...findMatches(text, "EMAIL", "regex", 1, EMAIL_PATTERN),
    ...findMatches(text, "PHONE", "regex", 1, PHONE_PATTERN),
    ...findCards(text),
    ...findMatches(text, "GOV_ID", "regex", 1, PAN_PATTERN),
    ...findMatches(text, "ACCOUNT", "regex", 1, IFSC_PATTERN),
    ...findMatches(text, "ACCOUNT", "regex", 1, UPI_PATTERN),
    ...findContextualNumbers(text, AADHAAR_PATTERN, AADHAAR_CONTEXT, "GOV_ID"),
    ...findContextualNumbers(text, ACCOUNT_NUMBER_PATTERN, ACCOUNT_CONTEXT, "ACCOUNT"),
  ];
}

/** Gives each candidate its vault token. The only place detections touch the vault. */
export function tokenise(candidates: PiiCandidate[], vault: TokenVault): PiiMatch[] {
  return candidates.map((candidate) => ({ ...candidate, token: vault.set(candidate.category, candidate.text) }));
}

export function detectEmails(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findMatches(text, "EMAIL", "regex", 1, EMAIL_PATTERN), vault);
}

export function detectPhones(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findMatches(text, "PHONE", "regex", 1, PHONE_PATTERN), vault);
}

export function detectCards(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findCards(text), vault);
}

export function detectPanNumbers(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findMatches(text, "GOV_ID", "regex", 1, PAN_PATTERN), vault);
}

export function detectIfscCodes(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findMatches(text, "ACCOUNT", "regex", 1, IFSC_PATTERN), vault);
}

export function detectUpiIds(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findMatches(text, "ACCOUNT", "regex", 1, UPI_PATTERN), vault);
}

export function detectAadhaarNumbers(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findContextualNumbers(text, AADHAAR_PATTERN, AADHAAR_CONTEXT, "GOV_ID"), vault);
}

export function detectAccountNumbers(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findContextualNumbers(text, ACCOUNT_NUMBER_PATTERN, ACCOUNT_CONTEXT, "ACCOUNT"), vault);
}
