import {
  findPiiTokens,
  sanitizeUrl,
  type PiiCategory,
  type ScreenElement,
  type ScreenGraph,
} from "@skrim/schema";

import { detectText, redactDomData, redactMatches, type NameLookup } from "../pii/redact.js";
import { TokenVault } from "../vault/vault.js";
import type { PageObservationMessage } from "../messages.ts";

/**
 * The privacy boundary. Everything the content script reads is raw page text;
 * these functions turn it into what may cross the network, against the one
 * vault the task keeps for its whole run.
 */

export type RedactionCounts = Partial<Record<PiiCategory, number>>;

export interface RedactedPage {
  graph: ScreenGraph;
  /** How many values were replaced with tokens in this view, by category. */
  redactions: RedactionCounts;
}

export function redactText(text: string, vault: TokenVault, names?: NameLookup): string {
  return redactMatches(text, detectText(text, vault, undefined, names));
}

/** Every raw text in a page view that redaction will look at: what the name finder must scan. */
export function pageTexts(observation: PageObservationMessage): string[] {
  const texts = new Set<string>();
  if (observation.title) texts.add(observation.title);
  for (const element of observation.elements ?? []) {
    for (const text of [element.label, element.value, element.hint]) if (text) texts.add(text);
  }
  return [...texts];
}

export function redactPage(observation: PageObservationMessage, cycle: number, vault: TokenVault, names?: NameLookup): RedactedPage {
  const redactions: RedactionCounts = {};
  const count = (category: PiiCategory) => { redactions[category] = (redactions[category] ?? 0) + 1; };

  const elements: ScreenElement[] = (observation.elements ?? []).map((element) => {
    const field = observation.fields?.[element.id];
    const redacted = redactDomData({ label: element.label, value: element.value, ...field }, vault, names);
    redacted.detections.forEach((detection) => count(detection.category));
    const hintMatches = element.hint ? detectText(element.hint, vault, undefined, names) : [];
    hintMatches.forEach((match) => count(match.category));
    return {
      ...element,
      label: redacted.label,
      value: redacted.value,
      hint: element.hint === undefined ? undefined : redactMatches(element.hint, hintMatches),
    };
  });

  const titleMatches = detectText(observation.title ?? "", vault, undefined, names);
  titleMatches.forEach((match) => count(match.category));
  const title = redactMatches(observation.title ?? "", titleMatches);

  const tokensInPlay = new Set<string>(findPiiTokens(title));
  for (const element of elements) {
    for (const text of [element.label, element.value, element.hint]) {
      if (text) findPiiTokens(text).forEach((token) => tokensInPlay.add(token));
    }
  }

  return {
    graph: {
      cycle,
      url: sanitizeUrl(observation.url ?? ""),
      title,
      viewport: observation.viewport ?? { width: 0, height: 0 },
      elements,
      ...(observation.beyondView ? { beyondView: observation.beyondView } : {}),
      manifest: { regions: [], tokensInPlay: [...tokensInPlay] },
    },
    redactions,
  };
}

/**
 * Swaps every PII token in a planned value for the real text. Fails when any
 * token is not in this task's vault: the model invented or misremembered it,
 * and typing "<PII:EMAIL:7>" into a real form is the one thing we never do.
 */
export function resolveTokens(value: string, vault: TokenVault): { ok: true; value: string } | { ok: false; unknown: string[] } {
  const tokens = findPiiTokens(value);
  const unknown = tokens.filter((token) => vault.resolve(token) === undefined);
  if (unknown.length > 0) return { ok: false, unknown };
  let resolved = value;
  for (const token of new Set(tokens)) resolved = resolved.split(token).join(vault.resolve(token)!);
  return { ok: true, value: resolved };
}
