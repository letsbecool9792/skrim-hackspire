import { type PiiCategory } from "@skrim/schema";

import { TokenVault } from "../vault/vault.js";
import { type PiiMatch } from "./regex.js";

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

export function tokeniseGlinerEntities(entities: GlinerEntity[], vault: TokenVault, minimumConfidence = 0.5): PiiMatch[] {
  const candidates = entities.filter((entity) => {
    const category = GLINER_LABEL_CATEGORIES[entity.label.toLowerCase()];
    return category !== undefined && entity.score >= minimumConfidence && entity.start >= 0 && entity.end > entity.start && entity.text.length === entity.end - entity.start;
  }).map((entity) => ({ entity, category: GLINER_LABEL_CATEGORIES[entity.label.toLowerCase()] as PiiCategory }))
    .sort((left, right) => right.entity.score - left.entity.score || left.entity.start - right.entity.start);

  const accepted: PiiMatch[] = [];
  for (const { entity, category } of candidates) {
    if (accepted.some((match) => entity.start < match.end && entity.end > match.start)) continue;
    accepted.push({ token: vault.set(category, entity.text), category, source: "ner", confidence: entity.score, text: entity.text, start: entity.start, end: entity.end });
  }
  return accepted.sort((left, right) => left.start - right.start);
}