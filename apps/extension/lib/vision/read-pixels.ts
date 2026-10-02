import type { BBox, ScreenElement } from "@skrim/schema";

import { captureTab } from "../capture/screenshot.ts";
import { shouldEscalateToVision } from "./escalation.ts";

/**
 * Text that exists only as pixels: drawn on a canvas, printed in an image (a
 * scanned ID card), or inside a cross-origin frame the content script cannot
 * read. The eval's only misses were all of this kind.
 *
 * One capture of the visible tab, then OCR on just those regions. Each line
 * read becomes a text element with source "vision", and from there it is
 * redacted like any other text: the pixels never leave the device, and
 * neither does anything personal the OCR read out of them.
 */

export interface PixelTarget {
  id: string;
  /** CSS pixels, relative to the viewport. */
  bbox: BBox;
}

/** A line of text read from a target, in CSS pixels. RAW text. */
export interface PixelLine {
  targetId: string;
  bbox: BBox;
  text: string;
  confidence: number;
}

/**
 * Reads the text in the given regions of the page as it is on screen now.
 * Resolves null when the page cannot be captured at the moment: its tab is
 * not the one showing, or it is a page the browser keeps extensions off.
 */
export type PixelReader = (targets: readonly PixelTarget[], viewport: { width: number; height: number }) => Promise<PixelLine[] | null>;

/** At most this many regions a view: each costs an OCR pass of 0.1-0.5 s. */
const MAX_TARGETS = 4;
/** Smaller than this holds no line of text worth reading. */
const MIN_SIZE = { width: 60, height: 20 };
/** OCR lines below this confidence are more likely noise than text. */
const MIN_CONFIDENCE = 0.5;

/** The regions worth reading: what the vision escalation policy names, in view, largest first. */
export function pixelTargets(elements: readonly ScreenElement[]): PixelTarget[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return shouldEscalateToVision([...elements]).reasons
    // A video's frames change under the OCR; faces in them are a later job.
    .filter((reason) => reason.reason !== "video")
    .map((reason) => byId.get(reason.elementId)!)
    .filter((element) => !element.state?.includes("offscreen") && element.bbox[2] >= MIN_SIZE.width && element.bbox[3] >= MIN_SIZE.height)
    .sort((left, right) => right.bbox[2] * right.bbox[3] - left.bbox[2] * left.bbox[3])
    .slice(0, MAX_TARGETS)
    .map((element) => ({ id: element.id, bbox: element.bbox }));
}

/**
 * The page's elements with each line read inserted after the element it was
 * read from, under new ids. They are text to read, not things to click: the
 * page has no element behind them.
 */
export function withPixelText(elements: readonly ScreenElement[], lines: readonly PixelLine[]): ScreenElement[] {
  let next = elements.reduce((highest, element) => Math.max(highest, Number(element.id.slice(1)) || 0), 0) + 1;
  return elements.flatMap((element) => [
    element,
    ...lines
      .filter((line) => line.targetId === element.id && line.confidence >= MIN_CONFIDENCE)
      .map((line): ScreenElement => ({ id: `e${next++}`, role: "text", label: line.text, bbox: line.bbox, source: "vision", confidence: Number(line.confidence.toFixed(2)) })),
  ]);
}

/** Reads pixels from one tab, and only while it is the tab on screen. */
export function tabPixelReader(tabId: number): PixelReader {
  return async (targets, viewport) => {
    if (targets.length === 0 || viewport.width <= 0) return [];
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    // The browser captures a window's active tab. If the user switched tabs,
    // the pixels would be another page's: never read those as this one's.
    if (!tab?.active || tab.windowId === undefined) return null;
    let image: ImageBitmap;
    try {
      const capture = await captureTab(tabId, tab.windowId);
      image = await createImageBitmap(new Blob([capture.data as BlobPart], { type: "image/png" }));
    } catch {
      return null;
    }
    const { recognizeLines } = await import("./ocr.ts");
    try {
      const scale = image.width / viewport.width;
      // Screen text is small for OCR; reading at twice device size helps.
      const zoom = scale < 2 ? 2 / scale : 1;
      const lines: PixelLine[] = [];
      for (const target of targets) {
        const [x, y, width, height] = target.bbox;
        const sx = Math.max(0, Math.round(x * scale));
        const sy = Math.max(0, Math.round(y * scale));
        const sw = Math.min(image.width - sx, Math.round(width * scale));
        const sh = Math.min(image.height - sy, Math.round(height * scale));
        if (sw <= 0 || sh <= 0) continue;
        const canvas = new OffscreenCanvas(Math.round(sw * zoom), Math.round(sh * zoom));
        canvas.getContext("2d")!.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const found = await recognizeLines(await canvas.convertToBlob({ type: "image/png" }));
        const factor = scale * zoom;
        for (const line of found) {
          lines.push({
            targetId: target.id,
            bbox: [Math.round(sx / scale + line.bbox[0] / factor), Math.round(sy / scale + line.bbox[1] / factor), Math.round(line.bbox[2] / factor), Math.round(line.bbox[3] / factor)],
            text: line.text,
            confidence: line.confidence,
          });
        }
      }
      return lines;
    } finally {
      // The capture lives only for this reading (lib/capture/CLAUDE.md).
      image.close();
    }
  };
}
