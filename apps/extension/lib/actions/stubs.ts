import { ActionResult } from './dispatcher.ts';
import type { ActionResult } from "./dispatcher.ts";

export function executeStub(actionType: string, actionId: string, observationVersion: number): ActionResult {
  // Phase 2: type - Resolve vault token, set value + dispatch input/change events, verify value set
  // Phase 2: scroll - scrollTo/scrollBy on target or window, verify scrollTop/scrollLeft changed
  // Phase 2: select - Set selectedIndex, dispatch input/change, verify selection
  // Phase 2: navigate - Check isNavigationAllowed(), window.location or history.back()
  // Phase 2: extract - Read sanitized element content, return via result
  // Phase 2: wait - setTimeout with cap at 10_000ms per schema

  return {
    ok: false,
    actionId,
    changed: false,
    errorCode: 'UNSUPPORTED_ACTION',
    observationVersion
  };
}
