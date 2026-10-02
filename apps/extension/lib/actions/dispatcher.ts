import { ActionSchema, type Action } from "@skrim/schema";
import { log } from "@skrim/shared";
import type { ErrorCode } from "@/lib/errors.ts";
import { executeClick } from "./click.ts";
import { executeExtract, executeNavigate, executeScroll, executeSelect, executeType, executeWait } from "./stubs.ts";

export interface ActionResult { ok: boolean; actionId: string; changed: boolean; completed?: boolean; errorCode?: ErrorCode; observationVersion: number; extractedValue?: string; }

export interface ActionRuntimeContext {
  resolveToken?: (value: string) => string | null;
}

export async function executeAction(action: Action, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number, context: ActionRuntimeContext = {}): Promise<ActionResult> {
  const parsed = ActionSchema.safeParse(action);
  if (!parsed.success) return { ok: false, actionId, changed: false, errorCode: "MALFORMED_ACTION", observationVersion: getObservationVersion() };
  try {
    let result: ActionResult;
    switch (action.type) {
      case "click": result = await executeClick(action.target, actionId, registry, getObservationVersion); break;
      case "type": result = await executeType(action, actionId, registry, getObservationVersion, context.resolveToken); break;
      case "scroll": result = await executeScroll(action, actionId, registry, getObservationVersion); break;
      case "select": result = await executeSelect(action, actionId, registry, getObservationVersion); break;
      case "navigate": result = await executeNavigate(action, actionId, getObservationVersion); break;
      case "extract": result = await executeExtract(action, actionId, registry, getObservationVersion); break;
      case "wait": result = await executeWait(action, actionId, getObservationVersion); break;
      case "done": result = { ok: true, actionId, changed: false, completed: true, observationVersion: getObservationVersion() }; break;
    }
    log.info("action.completed", { actionId, ok: result.ok, changed: result.changed });
    return result;
  } catch (error) {
    log.warn("action.failed", { actionId, error: String(error) });
    return { ok: false, actionId, changed: false, errorCode: "CONTENT_SCRIPT_ERROR", observationVersion: getObservationVersion() };
  }
}
