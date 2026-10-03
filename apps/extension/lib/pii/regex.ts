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
// An Indian mobile written without +91: ten digits starting 6 to 9, perhaps
// after a 0 ("98309 65520", "9830965520", "09830965520"). Hidden with or
// without a label: typed as "phone 9830965520" in a goal it went out as it was.
// A longer run of digits (an Aadhaar, a card, a 12-digit account) is never
// cut into one: the match must end where the digits do.
const LOCAL_MOBILE_PATTERN = /\b0?[6-9](?:[ -]?\d){9}\b/g;
// ...unless the words just before it name something else: "Order 9876543210",
// "PNR no: 8524123456". Only a label right before the number counts, so
// "ordered by 9830965520" is still a phone.
const NOT_A_PHONE = /\b(?:order|invoice|tracking|awb|shipment|reference|ref|ticket|pnr|booking|transaction|txn|receipt|serial|sku|isbn|account|a\/c)\s*(?:no\.?|number|id)?\s*[:#.-]?\s*$/i;
// Any other phone number after a word that names one: "Phone: 033 2456 7890".
const LABELLED_PHONE_PATTERN = /\b\d(?:[ .-]?\d){7,11}\b/g;
const PHONE_CONTEXT = /\b(?:phone|mobile|mob|cell|tel|telephone|whatsapp|landline|contact(?:\s+(?:number|no))?)\b/i;
const CARD_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/g;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const IFSC_PATTERN = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi;
// UPI handles have no top-level domain (name@okaxis, not name@example.com), so
// the handle may not continue into a dot and more letters. A sentence-ending
// period is still fine.
const UPI_PATTERN = /\b[a-z0-9][a-z0-9._-]{1,80}@[a-z][a-z0-9]{1,30}(?![a-z0-9-]|\.[a-z0-9])/gi;
const AADHAAR_PATTERN = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
const ACCOUNT_NUMBER_PATTERN = /\b\d{8,18}\b/g;

// "aadhaar" / "aadhar" / "uidai" are the direct labels. "id card" / "identity
// card" / "national id" / "government id" cover OCR reads of scanned ID card
// images, where the nearby text labels the document rather than the field.
const AADHAAR_CONTEXT = /aadhaar|aadhar|uidai|id\s+card|identity\s+card|national\s+id|government\s+id|govt\.?\s+id/i;
const ACCOUNT_CONTEXT = /account(?:\s+number|\s+no\.?|#)?/i;
// A date is a birth date only when labelled as one: every page is full of dates.
const DATE_PATTERN = /\b(?:\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2}|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (?:19|20)\d{2})\b/gi;
const DOB_CONTEXT = /date of birth|birth ?date|\bd\.?o\.?b\b|\bborn\b/i;

const PASSPORT_PATTERN = /\b[A-Z]\d{7}\b/gi;
const PASSPORT_CONTEXT = /passport/i;

// Must hold a digit: a label like "Patient ID" must not take the next word ("Next appointment").
const OTHER_ID_PATTERN = /\b(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,20}\b/gi;
const OTHER_ID_CONTEXT = /(?:patient|member|customer|employee)\s+id|policy\s+(?:number|no\.?|#)|\bmrn\b/i;

/** How far back a label may sit before the number it describes. */
const CONTEXT_WINDOW = 48;

/**
 * Words that lead into an email address rather than being part of one: "write
 * to us at help@...", "email: ...". Never joined to the address.
 */
const LEADS_INTO_ADDRESS = new Set(["at", "to", "or", "and", "is", "via", "email", "e-mail", "mail", "contact", "me", "us"]);

/**
 * Repairs OCR artefacts that break structured PII patterns, so an address is
 * hidden whole. Tesseract reads the dot inside an email's local part as a
 * space, or spaces it out: "karan.mehta@example.com" came back as "karan
 * mehta@example.com" from the iframe fixture in Chromium, and the email
 * detector then hid "mehta@example.com" and left "karan" readable.
 *
 * Only a word directly before the part with "@" is joined, and not one that
 * leads into an address ("at", "email"). Joining a word that was not part of
 * the address hides one word too many, of text read from pixels only: privacy
 * over context.
 */
export function normalizeOcrText(text: string): string {
  return text
    // "karan. mehta@", "karan, mehta@": the dot spaced out, or read as a comma.
    .replace(/(\w)[.,] (\w[^\s]*@)/g, "$1.$2")
    // "karan mehta@": the dot read as a space.
    .replace(/(^|[\s:(<])([A-Za-z0-9._%+-]+) ([A-Za-z0-9._%+-]+@)/g, (whole, lead: string, fragment: string, local: string) =>
      LEADS_INTO_ADDRESS.has(fragment.toLowerCase()) ? whole : `${lead}${fragment}.${local}`);
}

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

function findLocalMobiles(text: string): PiiCandidate[] {
  return findMatches(text, "PHONE", "regex", 0.9, LOCAL_MOBILE_PATTERN)
    .filter((candidate) => !NOT_A_PHONE.test(labelBefore(text, candidate.start)));
}

/** International numbers, labelled numbers, and Indian mobiles without +91; the first of any that overlap. */
function findPhones(text: string): PiiCandidate[] {
  const found: PiiCandidate[] = [];
  const candidates = [
    ...findMatches(text, "PHONE", "regex", 1, PHONE_PATTERN),
    ...findContextualNumbers(text, LABELLED_PHONE_PATTERN, PHONE_CONTEXT, "PHONE"),
    ...findLocalMobiles(text),
  ];
  for (const candidate of candidates) {
    if (!found.some((kept) => candidate.start < kept.end && kept.start < candidate.end)) found.push(candidate);
  }
  return found.sort((a, b) => a.start - b.start);
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
    ...findContextualNumbers(text, PASSPORT_PATTERN, PASSPORT_CONTEXT, "GOV_ID"),
    ...findContextualNumbers(text, ACCOUNT_NUMBER_PATTERN, ACCOUNT_CONTEXT, "ACCOUNT"),
    ...findContextualNumbers(text, OTHER_ID_PATTERN, OTHER_ID_CONTEXT, "OTHER"),
    ...findContextualNumbers(text, DATE_PATTERN, DOB_CONTEXT, "DOB"),
    // Last: on the same digits, "Account number 9876543210" is an account.
    ...findContextualNumbers(text, LABELLED_PHONE_PATTERN, PHONE_CONTEXT, "PHONE"),
    ...findLocalMobiles(text),
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
  return tokenise(findPhones(text), vault);
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
export function detectPassportNumbers(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findContextualNumbers(text, PASSPORT_PATTERN, PASSPORT_CONTEXT, "GOV_ID"), vault);
}
export function detectOtherIds(text: string, vault: TokenVault): PiiMatch[] {
  return tokenise(findContextualNumbers(text, OTHER_ID_PATTERN, OTHER_ID_CONTEXT, "OTHER"), vault);
}
