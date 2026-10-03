import { findPiiTokens, type Action } from "@skrim/schema";
import type { ActionResult } from "./dispatcher.ts";

type TypeAction = Extract<Action, { type: "type" }>;
type ScrollAction = Extract<Action, { type: "scroll" }>;
type SelectAction = Extract<Action, { type: "select" }>;
type NavigateAction = Extract<Action, { type: "navigate" }>;
type ExtractAction = Extract<Action, { type: "extract" }>;
type WaitAction = Extract<Action, { type: "wait" }>;

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

/** Input types that take typed text, as the DOM extractor counts them. */
const TEXT_INPUT_TYPES = new Set(["text", "email", "password", "search", "tel", "url", "number"]);

function isField(element: Element): element is Field {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable);
}

function isTextField(element: Element): element is Field {
  if (element instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(element.type) && !element.disabled && !element.readOnly;
  return element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable);
}

/** How far up from the target to look for the section it heads: a Google Form question is 3 levels. */
const MAX_SECTION_DEPTH = 5;

/**
 * The field to type into: the target itself, or the one text field it stands
 * for. On a Google Form the planner may pick a question's heading rather than
 * its box: a short answer's box is named by the heading (aria-labelledby), a
 * paragraph's only "Your answer". So a heading, a <label> or any other
 * element stands for the field it names, or else for the only field in its
 * own section of the page.
 */
function fieldFor(target: Element | undefined): Field | undefined {
  if (!target?.isConnected) return undefined;
  if (isField(target)) return target;
  if (target instanceof HTMLLabelElement && target.control && isTextField(target.control)) return target.control;
  if (target.id) {
    const named = Array.from(document.querySelectorAll("[aria-labelledby]"))
      .filter((element) => element.getAttribute("aria-labelledby")!.trim().split(/\s+/).includes(target.id) && isTextField(element));
    if (named.length === 1) return named[0] as Field;
  }
  // The nearest section holding any text field stands for it only if it holds one.
  let section: Element | null = target;
  for (let depth = 0; section && section !== document.body && depth <= MAX_SECTION_DEPTH; depth++, section = section.parentElement) {
    const fields = Array.from(section.querySelectorAll("input, textarea, [contenteditable]")).filter(isTextField);
    if (fields.length > 0) return fields.length === 1 ? fields[0] : undefined;
  }
  return undefined;
}

export async function executeType(action: TypeAction, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number, resolveToken?: (value: string) => string | null): Promise<ActionResult> {
  const element = fieldFor(registry.get(action.target));
  if (!element) return failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
  const value = resolveToken?.(action.value) ?? action.value;
  // Fail closed: never type a token into a real form, even one buried in a sentence.
  if (findPiiTokens(value).length > 0) return failure(actionId, "CONTENT_SCRIPT_ERROR", getObservationVersion);
  const before = getObservationVersion();
  // Typing what the field already holds changes nothing, and must not count
  // as progress: a planner told "verified" will happily do it again.
  const alreadyThere = readElementValue(element) === value;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  } else {
    element.textContent = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (action.submit) pressEnter(element);
  const typed = !alreadyThere && readElementValue(element) === value;
  return success(actionId, typed || (action.submit === true && getObservationVersion() > before), getObservationVersion);
}

/**
 * A synthetic Enter keydown does not submit a form; browsers only do that for
 * real key presses. So submit the field's form the way Enter would, with
 * validation and the submit event, and send the key events for pages that
 * listen for Enter themselves (search boxes, chat inputs).
 */
function pressEnter(element: HTMLElement): void {
  const key = (type: string) => new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true });
  // A page that handles Enter itself usually cancels the event; then it has
  // done the submitting, and doing it again would submit twice.
  const handledByPage = !element.dispatchEvent(key("keydown"));
  element.dispatchEvent(key("keypress"));
  element.dispatchEvent(key("keyup"));
  if (!handledByPage && element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
}

export async function executeScroll(action: ScrollAction, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number): Promise<ActionResult> {
  const target = action.target ? registry.get(action.target) : document.documentElement;
  if (!(target instanceof HTMLElement)) return failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
  const amount = action.amount ?? window.innerHeight;
  const before = [target.scrollLeft, target.scrollTop];
  target.scrollBy({ left: action.direction === "left" ? -amount : action.direction === "right" ? amount : 0, top: action.direction === "up" ? -amount : action.direction === "down" ? amount : 0, behavior: "instant" });
  // Unverified at the end of the page, so the planner stops scrolling.
  return success(actionId, target.scrollLeft !== before[0] || target.scrollTop !== before[1], getObservationVersion);
}

export async function executeSelect(action: SelectAction, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number): Promise<ActionResult> {
  const element = registry.get(action.target);
  if (!(element instanceof HTMLSelectElement)) return failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
  const wanted = action.value.trim().toLowerCase();
  const option = Array.from(element.options).find((candidate) => candidate.textContent?.trim().toLowerCase() === wanted || candidate.value.toLowerCase() === wanted);
  if (!option) return failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
  const before = element.selectedIndex;
  element.value = option.value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  // Choosing what was already chosen is not progress.
  return success(actionId, element.selectedIndex !== before, getObservationVersion);
}

export async function executeNavigate(action: NavigateAction, actionId: string, getObservationVersion: () => number): Promise<ActionResult> {
  if (action.to === "back") window.history.back();
  else {
    const destination = new URL(action.to, window.location.href);
    if (destination.origin !== window.location.origin) return failure(actionId, "NAVIGATION_BLOCKED", getObservationVersion);
    window.location.assign(destination.href);
  }
  return success(actionId, true, getObservationVersion);
}

/**
 * Reads an element's text for later steps. The raw text goes back to the side
 * panel, which redacts it before it is stored or sent. Reading changes nothing
 * on the page, so it counts as verified when there was something to read.
 */
export async function executeExtract(action: ExtractAction, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number): Promise<ActionResult> {
  const element = registry.get(action.target);
  if (!element || !element.isConnected) return failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
  const text = (readElementValue(element) || element.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 500);
  return { ...success(actionId, text.length > 0, getObservationVersion), extractedValue: text };
}

/** Waiting is what was asked for, so it always counts as verified. */
export async function executeWait(action: WaitAction, actionId: string, getObservationVersion: () => number): Promise<ActionResult> {
  await new Promise((resolve) => setTimeout(resolve, action.ms));
  return success(actionId, true, getObservationVersion);
}

function readElementValue(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
  return element.textContent ?? "";
}

function success(actionId: string, changed: boolean, getObservationVersion: () => number): ActionResult {
  return { ok: true, actionId, changed, observationVersion: getObservationVersion() };
}

function failure(actionId: string, errorCode: ActionResult["errorCode"], getObservationVersion: () => number): ActionResult {
  return { ok: false, actionId, changed: false, errorCode, observationVersion: getObservationVersion() };
}
