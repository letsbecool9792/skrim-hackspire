/**
 * What one reading of a fixture page produced, as the scoring needs it.
 *
 * Filled by the extension's eval hook in a real browser
 * (apps/extension/entrypoints/sidepanel/eval-hook.ts), or by the quick Node
 * check (apps/extension/scripts/eval-node.ts). Types only, so the extension
 * can import them without pulling in anything that runs.
 */

export interface PageTexts {
  title: string;
  /** Each element's texts. Raw and redacted lists match index for index. */
  elements: { label?: string; value?: string; hint?: string }[];
}

export interface Reading {
  /** RAW page text. Fixtures are synthetic, so this may be scored and printed. */
  raw: PageTexts;
  /** The same texts as the server would receive them. */
  redacted: PageTexts;
  /** Whether the page counted as showing the user's data (every name hidden). */
  personal: boolean;
  /** Elements left out for being far above or below the view. */
  beyondView: { above: number; below: number };
  /** visionMs: reading text from pixels (capture and OCR), 0 when nothing needed it. */
  timings: { observeMs: number; visionMs: number; namesMs: number; redactMs: number };
  /** Whether the name model ran: "failed" means names were only caught by rules. */
  nameModel: "on" | "failed" | "off";
}
