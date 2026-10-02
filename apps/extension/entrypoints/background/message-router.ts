import type { Message } from "@/lib/messages.ts";
import type { TaskStatus } from "@/lib/task-state.ts";
import type { ErrorCode } from "@/lib/errors.ts";
import { log } from "@skrim/shared";

export async function sendToContent(tabId: number, message: Message): Promise<void> {
  try {
    log.info("router.sendToContent", { type: message.type, tabId });
    await browser.tabs.sendMessage(tabId, message);
  } catch (error) {
    log.warn("router.sendToContent.failed", { type: message.type, tabId, error: String(error) });
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
