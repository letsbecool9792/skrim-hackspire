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

export async function captureIfNeeded(tabId: number): Promise<CaptureResult | null> {
  const startedAt = Date.now();
  if (startedAt - lastCaptureAt < CAPTURE_COOLDOWN_MS) return null;

  return timed("capture", async () => {
    try {
      const dataUri = await browser.tabs.captureVisibleTab({ format: "png" });
      const data = base64ToUint8Array(dataUri);
      lastCaptureAt = Date.now();
      let width = 0;
      let height = 0;
      if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
        width = (((data[16]! << 24) | (data[17]! << 16) | (data[18]! << 8) | data[19]!) >>> 0);
        height = (((data[20]! << 24) | (data[21]! << 16) | (data[22]! << 8) | data[23]!) >>> 0);
      }
      return { data, dataUri, capturedAt: lastCaptureAt, durationMs: lastCaptureAt - startedAt, width, height };
    } catch (error) {
      log.warn("capture.failed", { tabId, error: String(error) });
      return null;
    }
  });
}
