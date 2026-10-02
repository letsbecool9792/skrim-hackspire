import { z } from "zod";

/** [x, y, width, height] in CSS pixels, relative to the viewport. */
export const BBoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type BBox = z.infer<typeof BBoxSchema>;

/**
 * Element ids are `e` followed by digits: e0, e17, e204.
 *
 * Ids are assigned per observe cycle and are ONLY valid within the graph that
 * produced them. The server addresses actions at these ids, so an id that
 * silently changes meaning between cycles is a wrong-click on stage. If you
 * change id assignment, change it in one place.
 */
export const ElementIdSchema = z.string().regex(/^e\d+$/, "must look like e17");
export type ElementId = string;

/**
 * Roles we model. Deliberately a small closed set rather than the full ARIA
 * vocabulary: the server has to reason about these, and a long tail of rare
 * roles costs prompt tokens without improving decisions.
 *
 * Map anything unrecognised to "other" - never invent a role, and never add a
 * site-specific one. Skrim has to work on pages we have never seen (brief §4.6).
 */
export const ELEMENT_ROLES = [
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "slider",
  "tab",
  "menuitem",
  "heading",
  "text",
  "image",
  "table",
  "row",
  "cell",
  "list",
  "listitem",
  "form",
  "dialog",
  "region",
  "canvas", // opaque to the DOM - vision territory
  "iframe", // cross-origin ones are invisible to us by design
  "video",
  "other",
] as const;
export const ElementRoleSchema = z.enum(ELEMENT_ROLES);
export type ElementRole = (typeof ELEMENT_ROLES)[number];

export const ELEMENT_STATES = [
  "editable",
  "readonly",
  "disabled",
  "required",
  "invalid",
  "checked",
  "unchecked",
  "selected",
  "expanded",
  "collapsed",
  "focused",
  "offscreen",
] as const;
export const ElementStateSchema = z.enum(ELEMENT_STATES);
export type ElementState = (typeof ELEMENT_STATES)[number];

/**
 * How this element was discovered. Drives the 25% accuracy criterion: a
 * DOM-only team loses marks on canvas apps, and we need to be able to SHOW
 * which elements only vision found.
 */
export const ElementSourceSchema = z.enum(["dom", "vision", "fused"]);
export type ElementSource = z.infer<typeof ElementSourceSchema>;

/**
 * One node of the screen graph, already redacted.
 *
 * INVARIANT: by the time a ScreenElement exists, `label` and `value` contain
 * either safe text or PII tokens - never a raw email, phone number or name.
 * Redaction happens during graph construction, not before transmission.
 */
export const ScreenElementSchema = z.object({
  id: ElementIdSchema,
  role: ElementRoleSchema,

  /** Accessible name. Redacted. Omitted when the element has none. */
  label: z.string().optional(),

  /**
   * Current value for inputs, or text content for static nodes.
   * Holds a PiiToken when the real value was sensitive.
   */
  value: z.string().optional(),

  /** Placeholder / help text. Useful for form reasoning, rarely sensitive. */
  hint: z.string().optional(),

  bbox: BBoxSchema,
  state: z.array(ElementStateSchema).optional(),
  source: ElementSourceSchema,

  /**
   * Confidence for vision-sourced elements, 0-1. Absent for pure DOM nodes,
   * which are exact by construction.
   */
  confidence: z.number().min(0).max(1).optional(),

  /**
   * Child element ids. The graph is FLAT with id references rather than nested
   * objects - it keeps the JSON the model sees shallow and cheap, and avoids
   * unbounded recursion in validation.
   */
  children: z.array(ElementIdSchema).optional(),
});
export type ScreenElement = z.infer<typeof ScreenElementSchema>;
