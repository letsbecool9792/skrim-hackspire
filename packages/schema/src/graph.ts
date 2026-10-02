import { z } from "zod";
import { BBoxSchema, ScreenElementSchema } from "./element.js";
import { PiiCategorySchema, DetectionSourceSchema } from "./pii.js";

/**
 * URLs leak. `https://bank.example/account/8842910/statements?email=a@b.com`
 * identifies a person three different ways, and a naive agent would ship the
 * whole thing to the server as "context".
 *
 * So we never send a raw URL. We send the origin, a path with the identifying
 * segments replaced by placeholders, and a flag saying whether a query string
 * existed. The server gets enough to reason about where it is without getting
 * anything that names the user.
 */
export const SanitizedUrlSchema = z.object({
  /** Scheme + host, e.g. "https://bank.example". Safe: it is the site itself. */
  origin: z.string(),
  /** Path with identifying segments masked, e.g. "/account/{id}/statements". */
  pathTemplate: z.string(),
  /** Whether a query string was present. Its CONTENTS never cross the wire. */
  hasQuery: z.boolean(),
});
export type SanitizedUrl = z.infer<typeof SanitizedUrlSchema>;

/**
 * A region of the screenshot that was blacked out, described so the server is
 * not staring at an unexplained rectangle (brief section 6).
 *
 * This is brief §4.3, the server understanding the redaction, applied
 * to pixels: instead of hiding that something was there, we say what kind of
 * thing it was and where.
 */
export const RedactedRegionSchema = z.object({
  bbox: BBoxSchema,
  category: PiiCategorySchema,
  source: DetectionSourceSchema,
  confidence: z.number().min(0).max(1),
});
export type RedactedRegion = z.infer<typeof RedactedRegionSchema>;

export const RedactionManifestSchema = z.object({
  regions: z.array(RedactedRegionSchema),
  /** Tokens present in this graph, so the server knows what it may reference. */
  tokensInPlay: z.array(z.string()),
});
export type RedactionManifest = z.infer<typeof RedactionManifestSchema>;

/**
 * One observation of the screen. This is THE payload that crosses the network.
 *
 * Everything in here has already been redacted. If you are about to add a field,
 * ask whether it could carry PII - and if the answer is "only sometimes", it
 * still counts as yes.
 */
export const ScreenGraphSchema = z.object({
  /** Which observe/plan/act cycle produced this, starting at 0. */
  cycle: z.number().int().nonnegative(),
  url: SanitizedUrlSchema,
  /** Page title. Redacted - titles routinely contain names and order numbers. */
  title: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  /** Only elements in or near the view are listed. */
  elements: z.array(ScreenElementSchema),
  /**
   * How many elements were left out for being further above or below the
   * view. Counts only, so no PII. The planner scrolls to reach them.
   */
  beyondView: z.object({ above: z.number().int().nonnegative(), below: z.number().int().nonnegative() }).optional(),
  manifest: RedactionManifestSchema,
  /**
   * Optional redacted screenshot as a data URI. Only sent when the DOM alone is
   * insufficient - canvas, cross-origin iframes, embedded documents. Pixels are
   * the fallback, not the default (brief §4.1).
   */
  screenshot: z.string().optional(),
});
export type ScreenGraph = z.infer<typeof ScreenGraphSchema>;

/**
 * Build a SanitizedUrl from a real one. Any path segment that looks like an
 * identifier - long digit runs, uuids, hex blobs, things with @ in them - is
 * replaced. Conservative on purpose: over-masking costs the server a little
 * context, under-masking costs us the entire privacy claim.
 */
export function sanitizeUrl(raw: string): SanitizedUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { origin: "about:unknown", pathTemplate: "/", hasQuery: false };
  }

  const pathTemplate = parsed.pathname
    .split("/")
    .map((segment) => {
      if (segment === "") return segment;
      if (/^\d{3,}$/.test(segment)) return "{id}";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return "{uuid}";
      if (/^[0-9a-f]{16,}$/i.test(segment)) return "{hash}";
      if (segment.includes("@")) return "{email}";
      if (/\d{4,}/.test(segment)) return "{id}";
      return segment;
    })
    .join("/");

  return {
    origin: parsed.origin,
    pathTemplate: pathTemplate === "" ? "/" : pathTemplate,
    hasQuery: parsed.search.length > 0,
  };
}
