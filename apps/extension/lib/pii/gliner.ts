import { type PiiCategory } from "@skrim/schema";

import { TokenVault } from "../vault/vault.js";
import { type PiiCandidate, type PiiMatch, tokenise } from "./regex.js";

export interface GlinerEntity {
  text: string;
  label: string;
  start: number;
  end: number;
  score: number;
}

const GLINER_LABEL_CATEGORIES: Record<string, PiiCategory> = {
  person: "NAME",
  name: "NAME",
  address: "ADDRESS",
  location: "ADDRESS",
  employer: "OTHER",
  company: "OTHER",
  organization: "OTHER",
  organisation: "OTHER",
};

/**
 * What the extension asks GLiNER to find, and how sure it must be. Measured
 * with knowledgator/gliner-pii-edge-v1.0: "person" and "address"
 * found the names and addresses in the test sentences; at 0.5 it also called
 * "Friday" an address (0.55), at 0.6 nothing wrong came through. Organisations
 * are left out on purpose: shop and brand names are what the planner navigates by.
 */
export const NAME_LABELS = ["person", "address"] as const;
export const NAME_THRESHOLD = 0.6;

const DENYLIST_EXACT = new Set(["aadhaar", "aadhar", "uidai", "biryani", "koramangala", "skrim"]);
const BUSINESS_ADDRESS_WORDS = /\b(?:clinic|branch|hospital|bank|restaurant|store)\b/i;

/** Maps entities to redaction candidates, keeping the best of any overlapping ones. No tokens yet. */
export function glinerCandidates(entities: GlinerEntity[], minimumConfidence = 0.5): PiiCandidate[] {
  const candidates = entities.filter((entity) => {
    const category = GLINER_LABEL_CATEGORIES[entity.label.toLowerCase()];
    if (category === undefined || entity.score < minimumConfidence || entity.start < 0 || entity.end <= entity.start || entity.text.length !== entity.end - entity.start) return false;
    
    const lower = entity.text.toLowerCase().trim();
    if (category === "NAME" && DENYLIST_EXACT.has(lower)) return false;
    if (category === "ADDRESS" && BUSINESS_ADDRESS_WORDS.test(lower)) return false;
    
    return true;
  }).map((entity) => ({ entity, category: GLINER_LABEL_CATEGORIES[entity.label.toLowerCase()] as PiiCategory }))
    .sort((left, right) => right.entity.score - left.entity.score || left.entity.start - right.entity.start);

  const accepted: PiiCandidate[] = [];
  for (const { entity, category } of candidates) {
    if (accepted.some((match) => entity.start < match.end && entity.end > match.start)) continue;
    accepted.push({ category, source: "ner", confidence: entity.score, text: entity.text, start: entity.start, end: entity.end });
  }
  return accepted.sort((left, right) => left.start - right.start);
}

export function tokeniseGlinerEntities(entities: GlinerEntity[], vault: TokenVault, minimumConfidence = 0.5): PiiMatch[] {
  return tokenise(glinerCandidates(entities, minimumConfidence), vault);
}

/**
 * Finds names and addresses in many texts at once; one result list per text.
 * The loop runs it over each page view before redaction.
 */
export type NameFinder = (texts: readonly string[]) => Promise<PiiCandidate[][]>;

/** Anything with GlinerRunner's detect(); kept structural so this file stays free of the runtime. */
export interface EntityDetector {
  detect(texts: readonly string[], options: { labels: readonly string[]; threshold?: number }): Promise<GlinerEntity[][]>;
}

export function createNameFinder(detector: EntityDetector): NameFinder {
  return async (texts) => {
    const results = await detector.detect(texts, { labels: NAME_LABELS, threshold: NAME_THRESHOLD });
    return results.map((entities) => glinerCandidates(entities, NAME_THRESHOLD));
  };
}
