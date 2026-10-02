import type { Message } from "@/lib/messages.ts";
import type { TaskStatus } from "@/lib/task-state.ts";
import type { ErrorCode } from "@/lib/errors.ts";
import { log } from "@skrim/shared";

/**
 * Sends a message to the content script and returns its reply, or undefined if
 * nothing answered.
 *
 * The content script answers page.observe and action.execute with sendResponse.
 * A sendResponse reply comes back ONLY here, as the value tabs.sendMessage
 * resolves to; it never reaches runtime.onMessage. Callers must pass it on, or
 * the loop stalls waiting for a message that was already delivered.
 */
export async function sendToContent(tabId: number, message: Message): Promise<unknown> {
  try {
    log.info("router.sendToContent", { type: message.type, tabId });
    return await browser.tabs.sendMessage(tabId, message);
  } catch (error) {
    log.warn("router.sendToContent.failed", { type: message.type, tabId, error: String(error) });
    return undefined;
  }
}

export async function broadcastStatus(status: TaskStatus, taskId?: string, extra?: { stepCount?: number; maxSteps?: number; errorCode?: ErrorCode }): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: "task.status", status, taskId, ...extra });
  } catch {
    // The popup may be closed, which is expected.
  }
}

export async function getActiveTabId(): Promise<number | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? null;
  } catch (error) {
    log.warn("router.getActiveTabId.failed", { error: String(error) });
    return null;
  }
}
