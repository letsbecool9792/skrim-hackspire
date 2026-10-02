import { log } from '@skrim/shared';
import { parseMessage, type TaskStartMessage, type PageObservationMessage, type ActionResultMessage } from '@/lib/messages.ts';
import { taskManager } from './task-manager.ts';
import { sendToContent, broadcastStatus, getActiveTabId } from './message-router.ts';
import { newActionId } from '@/lib/id.ts';
import { log } from "@skrim/shared";
import { parseMessage } from "@/lib/messages.ts";
import { taskManager } from "./task-manager.ts";
import {
  sendToContent,
  broadcastStatus,
  getActiveTabId,
} from "./message-router.ts";
import { newActionId } from "@/lib/id.ts";

/**
 * THE ORCHESTRATOR. Owns the observe → plan → act → verify loop, task state,
 * and every call to the planning server.
 *
 * On Chrome this is a SERVICE WORKER: no DOM, no inference, can be killed at
 * any moment. On Firefox it is an event page (more permissive). Write for the
 * Chrome constraints — code that works there works in both.
 */
export default defineBackground(() => {
  log.info('background.started', { browser: import.meta.env.BROWSER });
  log.info("background.started", { browser: import.meta.env.BROWSER });

  browser.runtime.onMessage.addListener((rawMessage: unknown, sender) => {
    try {
  browser.runtime.onMessage.addListener(
    (rawMessage: unknown, _sender, sendResponse) => {
      const message = parseMessage(rawMessage);
      
      if (message.type === 'task.start') {
        const startMsg = message as TaskStartMessage;
        const taskState = taskManager.start(startMsg.goal);
        
        broadcastStatus(taskState.status, taskState.taskId, {
          stepCount: taskState.stepCount,
          maxSteps: taskState.maxSteps
        }).catch(() => {});
        
        getActiveTabId().then(tabId => {
          if (tabId) {
            sendToContent(tabId, { type: 'page.observe' });
          } else {
            taskManager.fail('NAV_NO_TAB');
            const state = taskManager.getState();
            broadcastStatus(state!.status, state!.taskId, { errorCode: state!.lastErrorCode });
            taskManager.clear();
          }
      if (!message) return false;

      if (message.type === "task.start") {
        handleTaskStart(message.goal);
      } else if (message.type === "task.cancel") {
        handleTaskCancel();
      } else if (message.type === "page.observation") {
        handleObservation(message.observationVersion, message.elementCount);
      } else if (message.type === "action.result") {
        handleActionResult(message.ok, message.changed, message.errorCode);
      }

      // Return true for all recognised messages — the response comes
      // asynchronously via broadcastStatus, not via sendResponse.
      return true;
    },
  );
});

async function handleTaskStart(goal: string): Promise<void> {
  const task = taskManager.start(goal);
  await broadcastStatus(task.status, task.taskId, {
    stepCount: task.stepCount,
    maxSteps: task.maxSteps,
  });

  const tabId = await getActiveTabId();
  if (!tabId) {
    taskManager.fail("CONTENT_SCRIPT_ERROR");
    const state = taskManager.getState();
    if (state) {
      await broadcastStatus(state.status, state.taskId, {
        errorCode: state.lastErrorCode,
      });
      taskManager.clear();
    }
    return;
  }

  // Initial observe — starts the loop.
  await sendToContent(tabId, {
    type: "page.observe",
    taskId: task.taskId,
  });
}

async function handleTaskCancel(): Promise<void> {
  taskManager.cancel();
  const state = taskManager.getState();
  if (state) {
    await broadcastStatus(state.status, state.taskId);
    taskManager.clear();
  }
}

/**
 * Phase 1: on observation, dispatch a hardcoded click on e0.
 * This is the WS4 planner integration point — replace the hardcoded
 * action with: build PlanRequest → POST to server → validate PlanResponse
 * → forward the returned Action to content.
 */
async function handleObservation(
  observationVersion: number,
  elementCount: number,
): Promise<void> {
  if (!taskManager.isRunning()) return;
  const state = taskManager.getState();
  if (!state) return;

  log.info("background.observation", {
    taskId: state.taskId,
    observationVersion,
    elementCount,
  });

  const tabId = await getActiveTabId();
  if (!tabId) return;

  // Phase 1: hardcoded click on e0. WS4 replaces this.
  const actionId = newActionId(state.stepCount);
  await sendToContent(tabId, {
    type: "action.execute",
    action: { type: "click", target: "e0" },
    actionId,
    taskId: state.taskId,
  });
}

async function handleActionResult(
  ok: boolean,
  changed: boolean,
  errorCode?: string,
): Promise<void> {
  if (!taskManager.isRunning()) return;
  const state = taskManager.getState();
  if (!state) return;

  log.info("background.actionResult", {
    taskId: state.taskId,
    ok,
    changed,
    step: state.stepCount,
  });

  if (ok && changed) {
    const canContinue = taskManager.incrementStep();
    if (!canContinue) {
      taskManager.fail("MAX_STEPS_REACHED");
      const finalState = taskManager.getState();
      if (finalState) {
        await broadcastStatus(finalState.status, finalState.taskId, {
          errorCode: finalState.lastErrorCode,
          stepCount: finalState.stepCount,
          maxSteps: finalState.maxSteps,
        });
      } else if (message.type === 'task.cancel') {
        taskManager.cancel();
        const state = taskManager.getState();
        if (state) {
          broadcastStatus(state.status, state.taskId).catch(() => {});
          taskManager.clear();
        }
      } else if (message.type === 'page.observation') {
        if (taskManager.isRunning()) {
          const obsMsg = message as PageObservationMessage;
          getActiveTabId().then(tabId => {
            if (tabId) {
              sendToContent(tabId, {
                type: 'action.execute',
                action: {
                  type: 'click',
                  target: 'e0'
                },
                actionId: newActionId()
              });
            }
          });
        }
      } else if (message.type === 'action.result') {
        if (taskManager.isRunning()) {
          const resMsg = message as ActionResultMessage;
          if (resMsg.result.ok && resMsg.result.changed) {
            if (taskManager.incrementStep()) {
              getActiveTabId().then(tabId => {
                if (tabId) {
                  sendToContent(tabId, { type: 'page.observe' });
                }
              });
            } else {
              taskManager.fail('STEPS_EXCEEDED');
              const finalState = taskManager.getState()!;
              broadcastStatus(finalState.status, finalState.taskId, { errorCode: finalState.lastErrorCode }).catch(() => {});
              taskManager.clear();
            }
          } else {
            taskManager.fail('ACT_FAILED');
            const finalState = taskManager.getState()!;
            broadcastStatus(finalState.status, finalState.taskId, { errorCode: finalState.lastErrorCode }).catch(() => {});
            taskManager.clear();
          }
        }
        taskManager.clear();
      }
    } catch (e) {
      log.warn('background.message.parseError', { rawMessage, error: e });
      return;
    }
    return true; 
  });
});

    // Re-observe after a successful action.
    const tabId = await getActiveTabId();
    if (tabId) {
      await sendToContent(tabId, {
        type: "page.observe",
        taskId: state.taskId,
      });
    }

    await broadcastStatus(state.status, state.taskId, {
      stepCount: state.stepCount,
      maxSteps: state.maxSteps,
    });
  } else {
    // Action failed or produced no change — stop the task.
    taskManager.fail("ACTION_TIMEOUT");
    const finalState = taskManager.getState();
    if (finalState) {
      await broadcastStatus(finalState.status, finalState.taskId, {
        errorCode: finalState.lastErrorCode,
        stepCount: finalState.stepCount,
        maxSteps: finalState.maxSteps,
      });
      taskManager.clear();
    }
  }
}
