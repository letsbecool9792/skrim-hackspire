import type { ActionResult } from "./dispatcher.ts";

export async function executeClick(targetId: string, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number): Promise<ActionResult> {
  const element = registry.get(targetId) as HTMLElement | undefined;
  if (!element) return { ok: false, actionId, changed: false, errorCode: "TARGET_NOT_FOUND", observationVersion: getObservationVersion() };
  const rect = element.getBoundingClientRect();
  const enabled = !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
  if (rect.width <= 0 || rect.height <= 0 || !enabled) return { ok: false, actionId, changed: false, errorCode: "TARGET_NOT_CLICKABLE", observationVersion: getObservationVersion() };
  element.scrollIntoView({ block: "center", behavior: "instant" });
  const before = getObservationVersion();
  const beforeChecked = element.matches(":checked");
  const beforeExpanded = element.getAttribute("aria-expanded");
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  element.focus();
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  await waitForClickResult(element, before, beforeChecked, beforeExpanded, getObservationVersion);
  const changed = getObservationVersion() > before || document.activeElement === element || element.matches(":checked") !== beforeChecked || element.getAttribute("aria-expanded") !== beforeExpanded;
  return { ok: changed, actionId, changed, errorCode: changed ? undefined : "ACTION_TIMEOUT", observationVersion: getObservationVersion() };
}

async function waitForClickResult(element: HTMLElement, before: number, beforeChecked: boolean, beforeExpanded: string | null, getObservationVersion: () => number): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline && getObservationVersion() === before && document.activeElement !== element && element.matches(":checked") === beforeChecked && element.getAttribute("aria-expanded") === beforeExpanded) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
