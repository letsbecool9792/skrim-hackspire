import { z } from "zod";

/**
 * PII categories the system can detect and tokenise.
 *
 * Adding a category is a CONTRACT CHANGE. The server's prompt has to learn what
 * the new token means, the vault has to know how to resolve it, and the eval
 * harness has to score it. Do not add one casually.
 */
export const PII_CATEGORIES = [
  "EMAIL",
  "PHONE",
  "NAME",
  "ADDRESS",
  "CARD",
  "GOV_ID", // Aadhaar, PAN, SSN, passport
  "ACCOUNT", // bank / customer account numbers
  "DOB",
  "FACE", // images only - never has a text value
  "OTHER",
] as const;

export const PiiCategorySchema = z.enum(PII_CATEGORIES);
export type PiiCategory = (typeof PII_CATEGORIES)[number];

/**
 * The wire format for redacted values: `<PII:EMAIL:1>`.
 *
 * This is the single most important string in the project. The server plans
 * over these tokens and hands them back in actions; the client resolves them
 * against the in-memory vault and types the real value into the real field.
 * That is what makes redaction referential rather than destructive (brief 4.3).
 *
 * NEVER build this string by hand. Use formatPiiToken() so the format can only
 * ever change in one place.
 */
export type PiiToken = `<PII:${PiiCategory}:${number}>`;

const TOKEN_PATTERN = new RegExp(`^<PII:(${PII_CATEGORIES.join("|")}):(\\d+)>$`);
const TOKEN_PATTERN_GLOBAL = new RegExp(`<PII:(${PII_CATEGORIES.join("|")}):(\\d+)>`, "g");

export const PiiTokenSchema = z
  .string()
  .regex(TOKEN_PATTERN, "must look like <PII:EMAIL:1>")
  .transform((s) => s as PiiToken);

/** Build a token. The only sanctioned way to produce one. */
export function formatPiiToken(category: PiiCategory, index: number): PiiToken {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`PII token index must be a non-negative integer, got ${index}`);
  }
  return `<PII:${category}:${index}>` as PiiToken;
}

/** Parse a token, or null if the string is not one. */
export function parsePiiToken(value: string): { category: PiiCategory; index: number } | null {
  const m = TOKEN_PATTERN.exec(value);
  if (!m) return null;
  return { category: m[1] as PiiCategory, index: Number(m[2]) };
}

export function isPiiToken(value: string): value is PiiToken {
  return TOKEN_PATTERN.test(value);
}

/** Every token embedded anywhere in a longer string. */
export function findPiiTokens(text: string): PiiToken[] {
  return [...text.matchAll(TOKEN_PATTERN_GLOBAL)].map((m) => m[0] as PiiToken);
}

/**
 * Where a detection came from. Kept on the wire because the 25% "accuracy of
 * visual context" criterion is partly a question of whether vision is pulling
 * its weight versus the DOM. We cannot answer that without provenance.
 */
export const DetectionSourceSchema = z.enum(["regex", "ner", "vision", "dom-type"]);
export type DetectionSource = z.infer<typeof DetectionSourceSchema>;

/**
 * One detected PII instance. Lives CLIENT-SIDE ONLY - this type never crosses
 * the network, because `text` holds the real value. It exists so the vault and
 * the eval harness agree on a shape.
 */
export const PiiDetectionSchema = z.object({
  token: PiiTokenSchema,
  category: PiiCategorySchema,
  source: DetectionSourceSchema,
  /** 0-1. Detection is statistical; we report confidence rather than pretend. */
  confidence: z.number().min(0).max(1),
  /** The real value. NEVER serialise this into an outbound request. */
  text: z.string().optional(),
  /** Present when found in pixels rather than text. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});
export type PiiDetection = z.infer<typeof PiiDetectionSchema>;
