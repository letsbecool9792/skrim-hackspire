import { Action, ActionSchema } from '@skrim/schema';
import { log, timed } from '@skrim/shared';
import { ErrorCode } from '@/lib/errors.ts';
import { executeClick } from './click.ts';
import { executeStub } from './stubs.ts';
import type { Action } from "@skrim/schema";
import { ActionSchema } from "@skrim/schema";
import { log, timed } from "@skrim/shared";
import type { ErrorCode } from "@/lib/errors.ts";
import { executeClick } from "./click.ts";
import { executeStub } from "./stubs.ts";

export interface ActionResult {
  ok: boolean;
  actionId: string;
  changed: boolean;
  errorCode?: ErrorCode;
  observationVersion: number;
}

export async function executeAction(action: Action, actionId: string, registry: Map<string, Element>, getObservationVersion: () => number): Promise<ActionResult> {
/**
 * Central action dispatch. Validates, routes to the correct handler,
 * instruments timing, and returns a structured result. Never throws.
 */
export async function executeAction(
  action: Action,
  actionId: string,
  registry: Map<string, Element>,
  getObservationVersion: () => number,
): Promise<ActionResult> {
  const parsed = ActionSchema.safeParse(action);
  if (!parsed.success) {
    return {
      ok: false,
      actionId,
      changed: false,
      errorCode: 'MALFORMED_ACTION',
      observationVersion: getObservationVersion()
      errorCode: "MALFORMED_ACTION",
      observationVersion: getObservationVersion(),
    };
  }

  log.info('action.dispatched', { type: action.type, actionId });
  log.info("action.dispatched", { type: action.type, actionId });

  let result: ActionResult;
  const result = await timed("action.execute", async () => {
    switch (action.type) {
      case "click":
        return executeClick(
          action.target,
          actionId,
          registry,
          getObservationVersion,
        );
      case "done":
        return {
          ok: true,
          actionId,
          changed: false,
          observationVersion: getObservationVersion(),
        } satisfies ActionResult;
      default:
        return executeStub(action.type, actionId, getObservationVersion());
    }
  });

  try {
    result = await timed('action.execute', async () => {
      switch (action.type) {
        case 'click':
          return await executeClick(action.target, registry, getObservationVersion, actionId);
        case 'done':
          return {
            ok: true,
            actionId,
            changed: false,
            observationVersion: getObservationVersion()
          };
        default:
          return executeStub(action.type, actionId, getObservationVersion());
      }
    });
  } catch (error) {
    result = {
      ok: false,
      actionId,
      changed: false,
      errorCode: 'ACTION_FAILED',
      observationVersion: getObservationVersion()
    };
  }
  log.info("action.completed", {
    actionId,
    ok: result.ok,
    changed: result.changed,
  });

  log.info('action.completed', { actionId, ok: result.ok, changed: result.changed });

  return result;
}
