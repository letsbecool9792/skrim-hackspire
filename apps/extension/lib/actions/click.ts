import type { ActionResult } from "./dispatcher.ts";

/** How long a click's effect may take to show before the step counts as unverified. */
const CLICK_SETTLE_MS = 1000;

/**
 * What a click can visibly change, captured before and after. Focus is
 * deliberately NOT in here: dispatching the click focuses the element itself,
 * so "it has focus" would verify every button, link and checkbox, including
 * ones whose click did nothing.
 */
interface ClickSignals {
  version: number;
  checked: boolean;
  expanded: string | null;
  pressed: string | null;
  selected: string | null;
  url: string;
  scrollX: number;
  scrollY: number;
}

function readSignals(element: HTMLElement, getObservationVersion: () => number): ClickSignals {
  return {
    version: getObservationVersion(),
    checked: element.matches(":checked"),
    expanded: element.getAttribute("aria-expanded"),
    pressed: element.getAttribute("aria-pressed"),
    selected: element.getAttribute("aria-selected"),
    // A same-page link changes only the hash and the scroll position.
    url: window.location.href,
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY),
  };
}

function changed(before: ClickSignals, after: ClickSignals): boolean {
  return (
    after.version > before.version ||
    after.checked !== before.checked ||
    after.expanded !== before.expanded ||
    after.pressed !== before.pressed ||
    after.selected !== before.selected ||
    after.url !== before.url ||
    after.scrollX !== before.scrollX ||
    after.scrollY !== before.scrollY
  );
}

export async function executeClick(targetId: string, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number): Promise<ActionResult> {
  const element = registry.get(targetId) as HTMLElement | undefined;
  if (!element || !element.isConnected) return { ok: false, actionId, changed: false, errorCode: "TARGET_NOT_FOUND", observationVersion: getObservationVersion() };
  const rect = element.getBoundingClientRect();
  const enabled = !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
  if (rect.width <= 0 || rect.height <= 0 || !enabled) return { ok: false, actionId, changed: false, errorCode: "TARGET_NOT_CLICKABLE", observationVersion: getObservationVersion() };
  element.scrollIntoView({ block: "center", behavior: "instant" });
  // Read after scrolling into view: that scroll is ours, not the click's effect.
  const before = readSignals(element, getObservationVersion);
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  element.focus();
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  const didChange = await waitForChange(element, before, getObservationVersion);
  // An unverified click is not an error: the step is reported with
  // changed: false and the planner decides what to do next.
  return { ok: true, actionId, changed: didChange, observationVersion: getObservationVersion() };
}

async function waitForChange(element: HTMLElement, before: ClickSignals, getObservationVersion: () => number): Promise<boolean> {
  const deadline = Date.now() + CLICK_SETTLE_MS;
  while (Date.now() < deadline) {
    if (changed(before, readSignals(element, getObservationVersion))) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return changed(before, readSignals(element, getObservationVersion));
}
