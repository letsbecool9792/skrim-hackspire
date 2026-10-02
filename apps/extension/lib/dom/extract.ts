import {
  ScreenElementSchema,
  type ScreenElement,
} from "@skrim/schema";

/**
 * Extracts a generic representation of the current page.
 *
 * No site-specific selectors.
 * No raw PII should be intentionally added here.
 */
export function extractScreenElements(): ScreenElement[] {
  const elements: ScreenElement[] = [];
  const candidates = document.querySelectorAll("*");

  for (const element of candidates) {
    if (!isRelevantElement(element)) {
      continue;
    }

    if (!isVisible(element)) {
      continue;
    }

    if (isAriaHidden(element)) {
      continue;
    }

    const screenElement: ScreenElement = {
      id: createElementId(elements.length),
      role: getRole(element),
      label: getAccessibleName(element),
      bbox: getBoundingBox(element),
      source: "dom",
      state: getState(element),
    };

    elements.push(screenElement);
  }

  for (const element of elements) {
    ScreenElementSchema.parse(element);
  }

  return elements;
}

function createElementId(index: number): string {
  return `e${index + 1}`;
}

function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

const INTERACTIVE_TAGS = new Set([
  "BUTTON",
  "A",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
]);

const STRUCTURAL_TAGS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "TABLE",
  "TR",
  "TD",
  "TH",
  "UL",
  "OL",
  "LI",
  "FORM",
  "DIALOG",
  "SECTION",
  "MAIN",
  "NAV",
  "ASIDE",
]);

const VISION_TARGET_TAGS = new Set(["IMG", "CANVAS", "IFRAME", "VIDEO"]);

const READABLE_TEXT_TAGS = new Set([
  "P",
  "SPAN",
  "DIV",
  "LABEL",
  "SMALL",
  "STRONG",
  "EM",
  "B",
  "I",
  "BLOCKQUOTE",
  "PRE",
  "CODE",
  "FIGCAPTION",
  "CAPTION",
  "DT",
  "DD",
]);

const SUPPORTED_ROLES = new Set<ScreenElement["role"]>([
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
  "canvas",
  "iframe",
  "video",
]);

function isRelevantElement(element: Element): boolean {
  const tag = element.tagName;

  if (INTERACTIVE_TAGS.has(tag) || STRUCTURAL_TAGS.has(tag) || VISION_TARGET_TAGS.has(tag)) {
    return true;
  }

  if (hasSupportedExplicitRole(element)) {
    return true;
  }

  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (hasFocusableTabIndex(element) || element.isContentEditable) {
    return true;
  }

  return (
    READABLE_TEXT_TAGS.has(tag) &&
    hasMeaningfulDirectText(element) &&
    !hasTextContainerAncestor(element)
  );
}

function hasSupportedExplicitRole(element: Element): boolean {
  const role = element.getAttribute("role")?.trim();
  return role !== undefined && SUPPORTED_ROLES.has(role as ScreenElement["role"]);
}

function hasFocusableTabIndex(element: HTMLElement): boolean {
  const tabindex = element.getAttribute("tabindex");

  if (tabindex === null || !/^-?\d+$/.test(tabindex)) {
    return false;
  }

  return Number(tabindex) >= -1;
}

function isAriaHidden(element: Element): boolean {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    if (current.getAttribute("aria-hidden") === "true") {
      return true;
    }
  }

  return false;
}

function hasMeaningfulDirectText(element: HTMLElement): boolean {
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  );
}

/**
 * A text container's accessible text already includes its descendants. Keeping
 * descendant spans/divs in that case would repeatedly serialize the same copy.
 */
function hasTextContainerAncestor(element: HTMLElement): boolean {
  let ancestor = element.parentElement;

  while (ancestor) {
    if (
      (READABLE_TEXT_TAGS.has(ancestor.tagName) || INTERACTIVE_TAGS.has(ancestor.tagName)) &&
      hasMeaningfulDirectText(ancestor)
    ) {
      return true;
    }

    ancestor = ancestor.parentElement;
  }

  return false;
}

const MAX_ACCESSIBLE_NAME_LENGTH = 200;

const TEXT_ENTRY_INPUT_TYPES = new Set([
  "text",
  "email",
  "password",
  "search",
  "tel",
  "url",
  "number",
]);

const TEXT_FALLBACK_ROLES = new Set<ScreenElement["role"]>([
  "button",
  "link",
  "heading",
  "option",
  "menuitem",
  "tab",
  "cell",
  "listitem",
  "text",
]);

function getAccessibleName(element: Element): string | undefined {
  const htmlElement = element as HTMLElement;

  // 1. aria-label
  const ariaLabel = normalizeText(htmlElement.getAttribute("aria-label"));
  if (ariaLabel) {
    return ariaLabel;
  }

  // 2. aria-labelledby
  const labelledBy = getAriaLabelledByText(element);
  if (labelledBy) {
    return labelledBy;
  }

  // 3. Associated <label>
  const associatedLabel = getAssociatedLabelText(element);
  if (associatedLabel) {
    return associatedLabel;
  }

  // 4. Placeholder
  if (isTextEntryControl(element)) {
    const placeholder = normalizeText(element.placeholder);
    if (placeholder) {
      return placeholder;
    }
  }

  // 5. Text content
  const textContent = getTextFallback(element);
  if (textContent) {
    return textContent;
  }

  // 6. title
  const title = normalizeText(htmlElement.getAttribute("title"));
  if (title) {
    return title;
  }

  // 7. alt text for images
  const alt = getAltText(element);
  if (alt) {
    return alt;
  }

  return undefined;
}

function normalizeText(text: string | null | undefined): string | undefined {
  const normalized = text?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, MAX_ACCESSIBLE_NAME_LENGTH) : undefined;
}

function getAriaLabelledByText(element: Element): string | undefined {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (!labelledBy) {
    return undefined;
  }

  const seenIds = new Set<string>();
  const parts: string[] = [];

  for (const id of labelledBy.trim().split(/\s+/)) {
    if (!id || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    const text = normalizeText(document.getElementById(id)?.textContent);
    if (text) {
      parts.push(text);
    }
  }

  return normalizeText(parts.join(" "));
}

function getAssociatedLabelText(element: Element): string | undefined {
  if (!isLabelableControl(element)) {
    return undefined;
  }

  return normalizeText(
    Array.from(element.labels ?? [])
      .map((label) => normalizeText(label.textContent))
      .filter((text): text is string => Boolean(text))
      .join(" "),
  );
}

function isLabelableControl(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function isTextEntryControl(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && TEXT_ENTRY_INPUT_TYPES.has(element.type))
  );
}

function getTextFallback(element: Element): string | undefined {
  if (!TEXT_FALLBACK_ROLES.has(getRole(element))) {
    return undefined;
  }

  return normalizeText(element.textContent);
}

function getAltText(element: Element): string | undefined {
  if (element instanceof HTMLImageElement) {
    return normalizeText(element.alt);
  }

  if (element instanceof HTMLInputElement && element.type === "image") {
    return normalizeText(element.alt);
  }

  return undefined;
}

function getRole(element: Element): ScreenElement["role"] {
  const explicitRole = element.getAttribute("role")?.trim();

  if (explicitRole && SUPPORTED_ROLES.has(explicitRole as ScreenElement["role"])) {
    return explicitRole as ScreenElement["role"];
  }

  switch (element.tagName) {
    case "BUTTON":
      return "button";

    case "A":
      return "link";

    case "TEXTAREA":
      return "textbox";

    case "SELECT":
      return "combobox";

    case "OPTION":
      return "option";

    case "IMG":
      return "image";

    case "CANVAS":
      return "canvas";

    case "IFRAME":
      return "iframe";

    case "VIDEO":
      return "video";

    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return "heading";

    case "P":
    case "SPAN":
    case "DIV":
    case "LABEL":
    case "SMALL":
    case "STRONG":
    case "EM":
    case "B":
    case "I":
    case "BLOCKQUOTE":
    case "PRE":
    case "CODE":
    case "FIGCAPTION":
    case "CAPTION":
    case "DT":
    case "DD":
      return "text";

    case "TABLE":
      return "table";

    case "TR":
      return "row";

    case "TD":
    case "TH":
      return "cell";

    case "UL":
    case "OL":
      return "list";

    case "LI":
      return "listitem";

    case "FORM":
      return "form";

    case "DIALOG":
      return "dialog";

    case "SECTION":
    case "MAIN":
    case "NAV":
    case "ASIDE":
      return "region";

    case "INPUT": {
      const type = (element as HTMLInputElement).type;

      switch (type) {
        case "checkbox":
          return "checkbox";
        case "radio":
          return "radio";
        case "range":
          return "slider";
        case "search":
          return "searchbox";
        default:
          return "textbox";
      }
    }

    default:
      return "other";
  }
}

function getBoundingBox(element: Element): ScreenElement["bbox"] {
  const rect = element.getBoundingClientRect();

  return [
    Math.round(rect.x),
    Math.round(rect.y),
    Math.round(rect.width),
    Math.round(rect.height),
  ];
}

function getState(element: Element): ScreenElement["state"] {
  if (!(element instanceof HTMLElement)) {
    return [];
  }

  const states: NonNullable<ScreenElement["state"]> = [];

  if ("disabled" in element && element.disabled) {
    states.push("disabled");
  }

  if ("checked" in element && element.checked) {
    states.push("checked");
  }

  if ("selected" in element && element.selected) {
    states.push("selected");
  }

  if ("required" in element && element.required) {
    states.push("required");
  }

  if (document.activeElement === element) {
    states.push("focused");
  }

  if ("readOnly" in element && element.readOnly) {
    states.push("readonly");
  }

  if (element.isContentEditable) {
    states.push("editable");
  }

  return states;
}
