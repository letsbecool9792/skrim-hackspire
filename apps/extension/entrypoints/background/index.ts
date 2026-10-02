import { log } from "@skrim/shared";
import { parseMessage, type PageObservationMessage, type ActionResultMessage } from "@/lib/messages.ts";
import { taskManager } from "./task-manager.ts";
import { broadcastStatus, getActiveTabId, sendToContent } from "./message-router.ts";
import { newActionId } from "@/lib/id.ts";
import { getActionPlanner, registerActionPlanner } from "@/lib/integration.ts";

export const setActionPlanner = registerActionPlanner;

export default defineBackground(() => {
  log.info("background.started");
  browser.runtime.onMessage.addListener((rawMessage: unknown) => {
    const message = parseMessage(rawMessage);
    if (!message) return false;
    if (message.type === "task.start") void startTask(message.goal);
    if (message.type === "task.cancel") void cancelTask();
    if (message.type === "page.observation") void handleObservation(message);
    if (message.type === "action.result") void handleActionResult(message);
    return false;
  });
});

async function startTask(goal: string): Promise<void> {
  const task = taskManager.start(goal);
  await broadcastStatus(task.status, task.taskId, { stepCount: 0, maxSteps: task.maxSteps });
  const tabId = await getActiveTabId();
  if (tabId === null) { taskManager.fail("CONTENT_SCRIPT_ERROR"); await finishTask(); return; }
  await sendToContent(tabId, { type: "page.observe", taskId: task.taskId });
}

async function cancelTask(): Promise<void> {
  taskManager.cancel();
  await finishTask();
}

async function handleObservation(message: PageObservationMessage): Promise<void> {
  if (!taskManager.isRunning()) return;
  const task = taskManager.getState();
  const tabId = await getActiveTabId();
  if (!task || tabId === null) return;
  if (!message.graphAvailable) {
    taskManager.fail("OBSERVATION_FAILED");
    await finishTask();
    return;
  }
  const actionPlanner = getActionPlanner();
  if (!actionPlanner) {
    taskManager.fail("UNSUPPORTED_ACTION");
    await finishTask();
    return;
  }
  const action = await actionPlanner({ goal: task.goal, observation: message });
  if (!action) {
    taskManager.fail("CONTENT_SCRIPT_ERROR");
    await finishTask();
    return;
  }
  await sendToContent(tabId, { type: "action.execute", action, actionId: newActionId(task.stepCount), taskId: task.taskId });
}

async function handleActionResult(message: ActionResultMessage): Promise<void> {
  if (!taskManager.isRunning()) return;
  const task = taskManager.getState();
  if (message.taskId && task?.taskId !== message.taskId) return;
  if (!message.ok) { taskManager.fail(message.errorCode ?? "CONTENT_SCRIPT_ERROR"); await finishTask(); return; }
  if (message.completed) { taskManager.complete(); await finishTask(); return; }
  if (!message.changed) { taskManager.fail(message.errorCode ?? "ACTION_TIMEOUT"); await finishTask(); return; }
  if (!taskManager.incrementStep()) { taskManager.fail("MAX_STEPS_REACHED"); await finishTask(); return; }
  const tabId = await getActiveTabId();
  if (tabId === null || !task) { taskManager.fail("CONTENT_SCRIPT_ERROR"); await finishTask(); return; }
  await sendToContent(tabId, { type: "page.observe", taskId: task.taskId });
}

async function finishTask(): Promise<void> {
  const state = taskManager.getState();
  if (state) await broadcastStatus(state.status, state.taskId, { stepCount: state.stepCount, maxSteps: state.maxSteps, errorCode: state.lastErrorCode });
  taskManager.clear();
}
