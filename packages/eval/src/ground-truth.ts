import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PII_CATEGORIES, type PiiCategory } from "@skrim/schema";

/**
 * Where a piece of PII sits on the page. Only "text", "field" and "title" are
 * in the DOM; the rest need vision, which is not in the loop yet, so they are
 * expected misses and reported apart.
 */
export const LOCATIONS = ["text", "field", "title", "canvas", "iframe", "image"] as const;
export type Location = (typeof LOCATIONS)[number];

export interface PiiItem {
  category: PiiCategory;
  /** Exactly as it appears on the page. */
  value: string;
  where: Location;
}

/**
 * One fixture's annotations. PII here means what Skrim promises to hide: the
 * user's data and the people in their private life. Public figures, shops and
 * organisations are not PII; they go in `notPii`, with the near-misses that
 * look like PII but are not (order numbers, ISBNs, dates), because hiding
 * them is scored too.
 */
export interface GroundTruth {
  page: string;
  /** One line: what the page is and what it tests. */
  about: string;
  pii: PiiItem[];
  notPii: string[];
  /** How many faces are on the page. */
  faces?: number;
}

function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

export function parseGroundTruth(file: string, data: unknown): GroundTruth {
  const truth = data as Partial<GroundTruth>;
  if (typeof truth.page !== "string" || !truth.page.endsWith(".html")) fail(file, "page must name an .html fixture");
  if (typeof truth.about !== "string") fail(file, "about must be a sentence");
  if (!Array.isArray(truth.pii) || !Array.isArray(truth.notPii)) fail(file, "pii and notPii must be arrays");
  if (truth.faces !== undefined && typeof truth.faces !== "number") fail(file, "faces must be a number");
  for (const item of truth.pii) {
    if (!PII_CATEGORIES.includes(item.category)) fail(file, `unknown category ${String(item.category)}`);
    if (typeof item.value !== "string" || item.value.length === 0) fail(file, "every pii item needs a value");
    if (!LOCATIONS.includes(item.where)) fail(file, `${item.value}: where must be one of ${LOCATIONS.join(", ")}`);
  }
  for (const value of truth.notPii) if (typeof value !== "string" || value.length === 0) fail(file, "notPii holds strings");
  return truth as GroundTruth;
}

export function loadGroundTruth(dir: string): GroundTruth[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => parseGroundTruth(name, JSON.parse(readFileSync(join(dir, name), "utf8"))));
}
