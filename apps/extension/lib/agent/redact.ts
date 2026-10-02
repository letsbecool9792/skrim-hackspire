import {
  findPiiTokens,
  sanitizeUrl,
  type PiiCategory,
  type ScreenElement,
  type ScreenGraph,
} from "@skrim/schema";

import { detectText, redactDomData, redactMatches, type NameLookup } from "../pii/redact.js";
import { normalizeOcrText } from "../pii/regex.js";
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

/** Longest label read as the label of the element after it, and longest text it may label. */
const SHORT_TEXT = 40;

/**
 * What labels an element, when the element before it does: the <dt> before a
 * <dd>, the <th> before a <td>. "12/03/1990" alone is a date; after "Date of
 * birth" it is a birth date. Only short texts count on both sides, so a
 * heading does not label the paragraph under it.
 */
export function labelBefore(elements: readonly ScreenElement[], index: number): string | undefined {
  const own = elements[index]?.label;
  if (!own || own.length > SHORT_TEXT) return undefined;
  // Skip one unlabelled element: a table row sits between a <th> and its <td>.
  for (const previous of elements.slice(Math.max(0, index - 2), index).reverse()) {
    if (previous.label) return previous.label.length <= SHORT_TEXT ? previous.label : undefined;
  }
  return undefined;
}

/**
 * For a vision element (source="vision"), the label of the DOM element whose
 * pixels were OCR'd — an image's alt text, a canvas's aria-label — describes
 * what was read ("Uploaded ID card"). Walk back past any vision siblings to
 * find the nearest non-vision element.
 */
function visionSourceLabel(elements: readonly ScreenElement[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el) break;
    if (el.source !== "vision") return el.label ?? undefined;
  }
  return undefined;
}

/**
 * What labels an element. A line read from pixels gets both the line before it
 * ("Aadhaar No." above the number, as on a card) and what the image is
 * ("Uploaded ID card"), the image's last: detectors look at the text just
 * before a value. More context only ever hides more.
 */
function contextFor(elements: readonly ScreenElement[], index: number): string | undefined {
  const before = labelBefore(elements, index);
  if (elements[index]?.source !== "vision") return before;
  const source = visionSourceLabel(elements, index);
  const parts = [...new Set([before, source].filter((part): part is string => Boolean(part)))];
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * A path segment can hold a name: "/users/asha-rao/orders". The names the task
 * knows (lib/agent/private-names.ts) are looked for in each segment, written
 * with spaces as a page would, and a segment holding one becomes "{name}".
 * Only names already known are found: the model does not read URLs.
 */
export function hideNamesInPath(pathTemplate: string, vault: TokenVault, names?: NameLookup): string {
  return pathTemplate
    .split("/")
    .map((segment) => {
      if (!segment || segment.startsWith("{")) return segment;
      let decoded = segment;
      try { decoded = decodeURIComponent(segment); } catch { /* not valid percent-encoding: use it as is */ }
      const spaced = decoded.replace(/[-_+.]+/g, " ");
      return detectText(spaced, vault, undefined, names).some((match) => match.category === "NAME") ? "{name}" : segment;
    })
    .join("/");
}

export function redactPage(observation: PageObservationMessage, cycle: number, vault: TokenVault, names?: NameLookup): RedactedPage {
  const redactions: RedactionCounts = {};
  const count = (category: PiiCategory) => { redactions[category] = (redactions[category] ?? 0) + 1; };

  const raw = observation.elements ?? [];
  const elements: ScreenElement[] = raw.map((element, index) => {
    const field = observation.fields?.[element.id];
    const context = contextFor(raw, index);
    // OCR sometimes inserts a space inside an email local-part ("karan. mehta@…").
    // Normalise before detection; the element label itself is preserved.
    const detectLabel = element.source === "vision" && element.label ? normalizeOcrText(element.label) : element.label;
    const redacted = redactDomData({ label: detectLabel, value: element.value, ...field, ...(context ? { context } : {}) }, vault, names);
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

  const url = sanitizeUrl(observation.url ?? "");
  url.pathTemplate = hideNamesInPath(url.pathTemplate, vault, names);

  return {
    graph: {
      cycle,
      url,
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
