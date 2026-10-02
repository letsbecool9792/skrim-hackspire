import { type Message } from '@/lib/messages.ts';
import { type TaskStatus } from '@/lib/task-state.ts';
import { type ErrorCode } from '@/lib/errors.ts';
import { log } from '@skrim/shared';
import type { Message } from "@/lib/messages.ts";
import type { TaskStatus } from "@/lib/task-state.ts";
import type { ErrorCode } from "@/lib/errors.ts";
import { log } from "@skrim/shared";

export async function sendToContent(tabId: number, message: Message): Promise<void> {
/**
 * Send a message to the content script in a specific tab.
 * Logs the message type and tab — never the payload.
 */
export async function sendToContent(
  tabId: number,
  message: Message,
): Promise<void> {
  try {
    log.info('messageRouter.sendToContent', { type: message.type, tabId });
    log.debug("router.sendToContent", { type: message.type, tabId });
    await browser.tabs.sendMessage(tabId, message);
  } catch (error) {
    log.error('messageRouter.sendToContent.error', { type: message.type, tabId, error });
  } catch {
    log.warn("router.sendToContent.failed", { type: message.type, tabId });
  }
}

/**
 * Broadcast a task.status message for the popup to receive.
 * Uses browser.runtime.sendMessage — if the popup is closed, the error
 * is caught and ignored (it is expected).
 */
export async function broadcastStatus(
  status: TaskStatus,
  taskId?: string,
  extra?: { stepCount?: number; maxSteps?: number; errorCode?: ErrorCode }
  extra?: {
    stepCount?: number;
    maxSteps?: number;
    errorCode?: ErrorCode;
  },
): Promise<void> {
  try {
    log.info('messageRouter.broadcastStatus', { status, taskId });
    log.debug("router.broadcastStatus", { status, taskId });
    await browser.runtime.sendMessage({
      type: 'task.status',
      type: "task.status" as const,
      status,
      taskId,
      ...extra
      ...extra,
    });
  } catch (error) {
    log.warn('messageRouter.broadcastStatus.error', { error, status });
  } catch {
    // Popup is closed — expected and harmless.
  }
}

/**
 * Find the active tab in the current window.
 * Returns null if no tab is found — never throws.
 */
export async function getActiveTabId(): Promise<number | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0 && tabs[0].id) {
      return tabs[0].id;
    }
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tabs[0]?.id ?? null;
  } catch {
    log.warn("router.getActiveTabId.failed");
    return null;
  } catch (error) {
    log.error('messageRouter.getActiveTabId.error', { error });
    return null;
  }
}
