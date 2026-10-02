import { log, timed } from "@skrim/shared";

export interface CaptureResult {
  data: Uint8Array;
  /** The same PNG as a data URI, which is what the OCR engine takes. In memory only. */
  dataUri: string;
  capturedAt: number;
  durationMs: number;
  width: number;
  height: number;
}

const CAPTURE_COOLDOWN_MS = 500;
let lastCaptureAt = 0;

function base64ToUint8Array(dataUri: string): Uint8Array {
  const binary = atob(dataUri.split(",")[1] ?? dataUri);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Captures the visible tab of a window: the given one, or the current one.
 * The browser shows only a window's active tab, so a caller that means one
 * tab must check it is active first. Throws when the browser refuses: on its
 * own pages, and on local files until file access is allowed. Waits out the
 * cooldown instead of skipping, so a user's click always gets a capture.
 */
export async function captureTab(tabId: number, windowId?: number): Promise<CaptureResult> {
  const wait = lastCaptureAt + CAPTURE_COOLDOWN_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const startedAt = Date.now();

  return timed("capture", async () => {
    let dataUri: string;
    try {
      dataUri = windowId === undefined
        ? await browser.tabs.captureVisibleTab({ format: "png" })
        : await browser.tabs.captureVisibleTab(windowId, { format: "png" });
    } catch (error) {
      // The browser's message names the page's URL; log only that it failed.
      log.warn("capture.failed", { tabId });
      throw error;
    }
    const data = base64ToUint8Array(dataUri);
    lastCaptureAt = Date.now();
    let width = 0;
    let height = 0;
    if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      width = (((data[16]! << 24) | (data[17]! << 16) | (data[18]! << 8) | data[19]!) >>> 0);
      height = (((data[20]! << 24) | (data[21]! << 16) | (data[22]! << 8) | data[23]!) >>> 0);
    }
    return { data, dataUri, capturedAt: lastCaptureAt, durationMs: lastCaptureAt - startedAt, width, height };
  });
}

/** For the frame-diff pipeline: skips instead of waiting, and never throws. */
export async function captureIfNeeded(tabId: number): Promise<CaptureResult | null> {
  if (Date.now() - lastCaptureAt < CAPTURE_COOLDOWN_MS) return null;
  try {
    return await captureTab(tabId);
  } catch {
    return null;
  }
}
