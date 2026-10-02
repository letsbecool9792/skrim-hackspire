import { log, timed } from "@skrim/shared";

/**
 * Screenshot capture result. Data stays in memory — never touches disk.
 */
export interface CaptureResult {
  data: Uint8Array;
  capturedAt: number;
  durationMs: number;
  width: number;
  height: number;
}

/** Minimum interval between captures (~2/sec hard cap in Chrome). */
const CAPTURE_COOLDOWN_MS = 500;
let lastCaptureAt = 0;
const CAPTURE_COOLDOWN_MS = 500;

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64.split(',')[1] || base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function captureIfNeeded(tabId: number): Promise<CaptureResult | null> {
/**
 * Capture the visible tab as a PNG, if the rate limit allows.
 * Returns null on rate-limit, failure, or missing permissions.
 * Never throws.
 */
export async function captureIfNeeded(
  tabId: number,
): Promise<CaptureResult | null> {
  const now = Date.now();
  if (now - lastCaptureAt < CAPTURE_COOLDOWN_MS) {
    return null;
  }

  return await timed('capture', async () => {
  return timed("capture", async () => {
    try {
      // @ts-ignore - browser is auto-imported by WXT
      const dataUri = await browser.tabs.captureVisibleTab({ format: 'png' });
      const dataUri: string = await browser.tabs.captureVisibleTab({
        format: "png",
      });
      const data = base64ToUint8Array(dataUri);
      

      lastCaptureAt = Date.now();
      const durationMs = lastCaptureAt - now;

      // Parse PNG IHDR for dimensions (bytes 16-23).
      let width = 0;
      let height = 0;
      
      // Parse PNG header for width and height
      if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
        width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
        height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
      if (
        data.length >= 24 &&
        data[0] === 0x89 &&
        data[1] === 0x50 &&
        data[2] === 0x4e &&
        data[3] === 0x47
      ) {
        width =
          ((data[16]! << 24) |
            (data[17]! << 16) |
            (data[18]! << 8) |
            data[19]!) >>>
          0;
        height =
          ((data[20]! << 24) |
            (data[21]! << 16) |
            (data[22]! << 8) |
            data[23]!) >>>
          0;
      }

      lastCaptureAt = Date.now();
      
      return {
        data,
        capturedAt: lastCaptureAt,
        durationMs: Date.now() - now,
        width,
        height
      };
    } catch (error) {
      log.warn('capture.failed', { tabId });
      log.debug("capture.ok", { durationMs, width, height });
      return { data, capturedAt: lastCaptureAt, durationMs, width, height };
    } catch {
      log.warn("capture.failed", { tabId });
      return null;
    }
  });
}

function base64ToUint8Array(dataUri: string): Uint8Array {
  const base64 = dataUri.split(",")[1] ?? dataUri;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
