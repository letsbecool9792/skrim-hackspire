import { type PiiMatch, detectAccountNumbers, detectAadhaarNumbers, detectCards, detectEmails, detectIfscCodes, detectPanNumbers, detectPhones, detectUpiIds } from "./regex.js";
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

function detectText(text: string, vault: TokenVault): PiiMatch[] {
  const candidates = [...detectEmails(text, vault), ...detectPhones(text, vault), ...detectCards(text, vault), ...detectPanNumbers(text, vault), ...detectIfscCodes(text, vault), ...detectUpiIds(text, vault), ...detectAadhaarNumbers(text, vault), ...detectAccountNumbers(text, vault)].sort((left, right) => left.start - right.start || right.end - left.end);
  const accepted: PiiMatch[] = [];
  for (const candidate of candidates) {
    if (accepted.some((match) => candidate.start < match.end && candidate.end > match.start)) continue;
    accepted.push(candidate);
  }
  return accepted;
}

export function redactDomData(data: { label?: string; value?: string; inputType?: string }, vault: TokenVault): RedactedDomData {
  const detections: PiiMatch[] = [];
  const redact = (text: string, matches: PiiMatch[]): string => {
    detections.push(...matches);
    return redactMatches(text, matches);
  };
  const labelMatches = data.label ? detectText(data.label, vault) : [];
  const valueMatches = data.inputType === "password" || data.inputType === "new-password"
    ? data.value ? [detectPasswordValue(data.value, vault)].filter((match): match is PiiMatch => match !== null) : []
    : data.value ? detectText(data.value, vault) : [];
  return {
    label: data.label === undefined ? undefined : redact(data.label, labelMatches),
    value: data.value === undefined ? undefined : redact(data.value, valueMatches),
    detections,
  };
}