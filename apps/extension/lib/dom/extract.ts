import {
  ScreenElementSchema,
  type ElementState,
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
  const includedElements = new Map<Element, ScreenElement>();
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
    includedElements.set(element, screenElement);
  }

  addChildren(includedElements);

  for (const element of elements) {
    ScreenElementSchema.parse(element);
  }

  return elements;
}

function addChildren(includedElements: Map<Element, ScreenElement>): void {
  const childIdsByParent = new Map<ScreenElement, Set<ScreenElement["id"]>>();

  for (const [element, screenElement] of includedElements) {
    let ancestor = element.parentElement;

    while (ancestor) {
      const parent = includedElements.get(ancestor);
      if (parent) {
        if (parent !== screenElement) {
          const childIds = childIdsByParent.get(parent) ?? new Set();
          childIds.add(screenElement.id);
          childIdsByParent.set(parent, childIds);
        }
        break;
      }

      ancestor = ancestor.parentElement;
    }
  }

  for (const [parent, childIds] of childIdsByParent) {
    parent.children = [...childIds];
  }
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
  const states = new Set<ElementState>();

  if (isOffscreen(element)) {
    states.add("offscreen");
  }

  const nativeDisabled = isNativeDisabled(element);
  const ariaDisabled = getAriaBoolean(element, "aria-disabled");
  const disabled = nativeDisabled || ariaDisabled === true;
  const nativeReadonly = isNativeReadonly(element);

  if (disabled) {
    states.add("disabled");
  }

  if (isNativeCheckableControl(element)) {
    const nativeChecked = getNativeCheckedState(element);
    if (nativeChecked) {
      setCheckedState(states, nativeChecked);
    }
  } else {
    const ariaChecked = getAriaBoolean(element, "aria-checked");
    if (ariaChecked !== undefined) {
      setCheckedState(states, ariaChecked ? "checked" : "unchecked");
    }
  }

  if (element instanceof HTMLOptionElement) {
    if (element.selected) {
      states.add("selected");
    }
  } else if (getAriaBoolean(element, "aria-selected") === true) {
    states.add("selected");
  }

  if (
    (isNativeRequiredControl(element) && element.required) ||
    getAriaBoolean(element, "aria-required") === true
  ) {
    states.add("required");
  }

  if (nativeReadonly) {
    states.add("readonly");
  }

  if (isNativeEditable(element) && !disabled && !nativeReadonly) {
    setEditableState(states);
  }

  if (isAriaInvalid(element)) {
    states.add("invalid");
  }

  const ariaExpanded = getAriaBoolean(element, "aria-expanded");
  if (ariaExpanded !== undefined) {
    setExpandedState(states, ariaExpanded ? "expanded" : "collapsed");
  }

  if (document.activeElement === element) {
    states.add("focused");
  }

  return [...states];
}

function isOffscreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();

  return (
    rect.right <= 0 ||
    rect.bottom <= 0 ||
    rect.left >= window.innerWidth ||
    rect.top >= window.innerHeight
  );
}

function isNativeDisabled(element: Element): boolean {
  return isNativeDisableable(element) && element.matches(":disabled");
}

function isNativeDisableable(
  element: Element,
): element is
  | HTMLButtonElement
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement
  | HTMLOptionElement
  | HTMLOptGroupElement
  | HTMLFieldSetElement {
  return (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLOptionElement ||
    element instanceof HTMLOptGroupElement ||
    element instanceof HTMLFieldSetElement
  );
}

function getNativeCheckedState(element: Element): "checked" | "unchecked" | undefined {
  if (!isNativeCheckableControl(element)) {
    return undefined;
  }

  if (element.indeterminate) {
    return undefined;
  }

  return element.checked ? "checked" : "unchecked";
}

function isNativeCheckableControl(element: Element): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
  );
}

function isNativeRequiredControl(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function isNativeReadonly(element: Element): boolean {
  return (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    element.readOnly
  );
}

function isNativeEditable(element: Element): boolean {
  return (
    (element instanceof HTMLElement && element.isContentEditable) ||
    isTextEntryControl(element)
  );
}

function getAriaBoolean(element: Element, attribute: string): boolean | undefined {
  const value = element.getAttribute(attribute)?.trim().toLowerCase();

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function isAriaInvalid(element: Element): boolean {
  const value = element.getAttribute("aria-invalid")?.trim().toLowerCase();
  return value === "true" || value === "grammar" || value === "spelling";
}

function setCheckedState(
  states: Set<ElementState>,
  state: "checked" | "unchecked",
): void {
  states.delete(state === "checked" ? "unchecked" : "checked");
  states.add(state);
}

function setExpandedState(
  states: Set<ElementState>,
  state: "expanded" | "collapsed",
): void {
  states.delete(state === "expanded" ? "collapsed" : "expanded");
  states.add(state);
}

function setEditableState(states: Set<ElementState>): void {
  states.delete("readonly");
  states.add("editable");
}
