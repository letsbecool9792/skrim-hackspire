import type { Action } from "@skrim/schema";
import type { ActionResult } from "./dispatcher.ts";

type TypeAction = Extract<Action, { type: "type" }>;
type ScrollAction = Extract<Action, { type: "scroll" }>;
type SelectAction = Extract<Action, { type: "select" }>;
type NavigateAction = Extract<Action, { type: "navigate" }>;
type ExtractAction = Extract<Action, { type: "extract" }>;
type WaitAction = Extract<Action, { type: "wait" }>;

export async function executeType(action: TypeAction, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number, resolveToken?: (value: string) => string | null): Promise<ActionResult> {
  const element = registry.get(action.target);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLElement && element.isContentEditable)) return failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
  const value = resolveToken?.(action.value) ?? (action.value.startsWith("<PII:") ? null : action.value);
  if (value === null) return failure(actionId, "CONTENT_SCRIPT_ERROR", getObservationVersion);
  const before = getObservationVersion();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  } else {
    element.textContent = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (action.submit) element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return success(actionId, getObservationVersion() > before || readElementValue(element) === value, getObservationVersion);
}

export async function executeScroll(action: ScrollAction, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number): Promise<ActionResult> {
  const target = action.target ? registry.get(action.target) : document.documentElement;
  if (!(target instanceof HTMLElement)) return failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
  const amount = action.amount ?? window.innerHeight;
  target.scrollBy({ left: action.direction === "left" ? -amount : action.direction === "right" ? amount : 0, top: action.direction === "up" ? -amount : action.direction === "down" ? amount : 0, behavior: "instant" });
  return success(actionId, true, getObservationVersion);
}

export async function executeSelect(action: SelectAction, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number): Promise<ActionResult> {
  const element = registry.get(action.target);
  if (!(element instanceof HTMLSelectElement)) return failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
  const option = Array.from(element.options).find((candidate) => candidate.textContent?.trim() === action.value || candidate.value === action.value);
  if (!option) return failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
  element.value = option.value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return success(actionId, true, getObservationVersion);
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

export async function executeExtract(action: ExtractAction, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number): Promise<ActionResult> {
  return registry.has(action.target) ? success(actionId, false, getObservationVersion) : failure(actionId, "TARGET_NOT_FOUND", getObservationVersion);
}

export async function executeWait(action: WaitAction, actionId: string, getObservationVersion: () => number): Promise<ActionResult> {
  await new Promise((resolve) => setTimeout(resolve, action.ms));
  return success(actionId, false, getObservationVersion);
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
