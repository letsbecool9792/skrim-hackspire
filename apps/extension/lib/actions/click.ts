import { ActionResult } from './dispatcher.ts';
import { log, timed } from '@skrim/shared';
import type { ActionResult } from "./dispatcher.ts";
import { timed } from "@skrim/shared";

export async function executeClick(targetId: string, registry: Map<string, Element>, getObservationVersion: () => number, actionId: string): Promise<ActionResult> {
  const element = registry.get(targetId) as HTMLElement;
  
/**
 * Execute a click action against a resolved element.
 *
 * Dispatches events in the order a real user produces them, then waits
 * up to 500ms for the MutationObserver to record a change. Returns a
 * structured result — never throws.
 */
export async function executeClick(
  targetId: string,
  actionId: string,
  registry: Map<string, Element>,
  getObservationVersion: () => number,
): Promise<ActionResult> {
  const element = registry.get(targetId) as HTMLElement | undefined;

  if (!element) {
    return {
      ok: false,
      actionId,
      changed: false,
      errorCode: 'TARGET_NOT_FOUND',
      observationVersion: getObservationVersion()
      errorCode: "TARGET_NOT_FOUND",
      observationVersion: getObservationVersion(),
    };
  }

  // Visibility and interactability checks.
  const rect = element.getBoundingClientRect();
  const isVisible = rect.width > 0 && rect.height > 0 && element.offsetParent !== null;
  const isEnabled = !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true';
  const isVisible =
    rect.width > 0 && rect.height > 0 && element.offsetParent !== null;
  const isEnabled =
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true";

  if (!isVisible || !isEnabled) {
    return {
      ok: false,
      actionId,
      changed: false,
      errorCode: 'TARGET_NOT_CLICKABLE',
      observationVersion: getObservationVersion()
      errorCode: "TARGET_NOT_CLICKABLE",
      observationVersion: getObservationVersion(),
    };
  }

  element.scrollIntoView({ block: 'center', behavior: 'instant' });
  // Scroll into view before clicking.
  element.scrollIntoView({ block: "center", behavior: "instant" });

  // Snapshot pre-click state for verification.
  const preClickVersion = getObservationVersion();
  const initialChecked = (element as HTMLInputElement).checked;
  const initialExpanded = element.getAttribute('aria-expanded');
  const initialExpanded = element.getAttribute("aria-expanded");
  const initialClassList = element.className;
  const initialActiveElement = document.activeElement;

  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  
  if (typeof element.focus === 'function') {
  // Dispatch user-like event sequence.
  element.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
  );
  element.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  if (typeof element.focus === "function") {
    element.focus();
  }
  
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  element.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
  );
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  await timed('action.verify', async () => {
  // Wait up to 500ms for mutations.
  await timed("action.verify", async () => {
    let waited = 0;
    while (waited < 500) {
      if (getObservationVersion() > preClickVersion) {
        break;
      }
      await new Promise(r => setTimeout(r, 50));
      if (getObservationVersion() > preClickVersion) break;
      await new Promise<void>((r) => setTimeout(r, 50));
      waited += 50;
    }
  });

  // Verify state change.
  const versionChanged = getObservationVersion() > preClickVersion;
  const stateChanged = 
  const stateChanged =
    (element as HTMLInputElement).checked !== initialChecked ||
    element.getAttribute('aria-expanded') !== initialExpanded ||
    element.className !== initialClassList ||
    document.activeElement !== initialActiveElement;
    element.getAttribute("aria-expanded") !== initialExpanded ||
    element.className !== initialClassList;

  return {
    ok: true,
    actionId,
    changed: versionChanged || stateChanged,
    observationVersion: getObservationVersion()
    observationVersion: getObservationVersion(),
  };
}
