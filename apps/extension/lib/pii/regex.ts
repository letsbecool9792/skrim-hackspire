import { type DetectionSource, type PiiCategory, type PiiDetection } from "@skrim/schema";

import { TokenVault } from "../vault/vault.js";

export interface PiiMatch extends PiiDetection {
  start: number;
  end: number;
}

const EMAIL_PATTERN = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/gi;
const PHONE_PATTERN = /\+\d{1,3}(?:[\s.-]?\d){7,12}\b/g;
const CARD_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/g;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const IFSC_PATTERN = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi;
const UPI_PATTERN = /\b[a-z0-9][a-z0-9._-]{1,80}@[a-z][a-z0-9.-]{1,30}\b/gi;
const AADHAAR_PATTERN = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
const ACCOUNT_NUMBER_PATTERN = /\b\d{8,18}\b/g;

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

function detectMatches(text: string, category: PiiCategory, source: DetectionSource, confidence: number, pattern: RegExp, vault: TokenVault): PiiMatch[] {
  return [...text.matchAll(pattern)].map((match) => {
    const value = match[0];
    const start = match.index ?? 0;
    return { token: vault.set(category, value), category, source, confidence, text: value, start, end: start + value.length };
  });
}

function detectContextualNumbers(text: string, pattern: RegExp, contextPattern: RegExp, category: PiiCategory, vault: TokenVault): PiiMatch[] {
  return [...text.matchAll(pattern)].filter((match) => {
    const start = match.index ?? 0;
    return contextPattern.test(text.slice(Math.max(0, start - 48), start));
  }).map((match) => {
    const value = match[0];
    const start = match.index ?? 0;
    return { token: vault.set(category, value), category, source: "regex" as const, confidence: 0.95, text: value, start, end: start + value.length };
  });
}

export function detectEmails(text: string, vault: TokenVault): PiiMatch[] {
  return detectMatches(text, "EMAIL", "regex", 1, EMAIL_PATTERN, vault);
}

export function detectPhones(text: string, vault: TokenVault): PiiMatch[] {
  return detectMatches(text, "PHONE", "regex", 1, PHONE_PATTERN, vault);
}

export function detectCards(text: string, vault: TokenVault): PiiMatch[] {
  return [...text.matchAll(CARD_PATTERN)].filter((match) => passesLuhn(match[0].replace(/[ -]/g, ""))).map((match) => {
    const value = match[0];
    const start = match.index ?? 0;
    return { token: vault.set("CARD", value), category: "CARD" as const, source: "regex" as const, confidence: 1, text: value, start, end: start + value.length };
  });
}

export function detectPanNumbers(text: string, vault: TokenVault): PiiMatch[] {
  return detectMatches(text, "GOV_ID", "regex", 1, PAN_PATTERN, vault);
}

export function detectIfscCodes(text: string, vault: TokenVault): PiiMatch[] {
  return detectMatches(text, "ACCOUNT", "regex", 1, IFSC_PATTERN, vault);
}

export function detectUpiIds(text: string, vault: TokenVault): PiiMatch[] {
  return detectMatches(text, "ACCOUNT", "regex", 1, UPI_PATTERN, vault);
}

export function detectAadhaarNumbers(text: string, vault: TokenVault): PiiMatch[] {
  return detectContextualNumbers(text, AADHAAR_PATTERN, /aadhaar|aadhar|uidai/i, "GOV_ID", vault);
}

export function detectAccountNumbers(text: string, vault: TokenVault): PiiMatch[] {
  return detectContextualNumbers(text, ACCOUNT_NUMBER_PATTERN, /account(?:\s+number|\s+no\.?|#)?/i, "ACCOUNT", vault);
}