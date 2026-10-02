import type { ScreenElement } from "@skrim/schema";

export type VisionEscalationReason =
  | "canvas"
  | "iframe"
  | "video"
  | "unlabelled-image"
  | "large-image";

/**
 * An image this big can hold readable text whatever its alt text says: the
 * alt of a scanned ID card says what the image is ("Uploaded ID card"), not
 * the name and number printed on it.
 */
const LARGE_IMAGE = { width: 200, height: 100 };

export interface VisionEscalation {
  elementId: string;
  reason: VisionEscalationReason;
}

export interface VisionEscalationDecision {
  shouldEscalate: boolean;
  reasons: VisionEscalation[];
}

/**
 * Decides whether the current DOM graph contains content that the DOM
 * cannot reliably describe and therefore warrants a local vision pass.
 *
 * This function does not capture screenshots or run inference.
 * It is intentionally pure so the escalation policy can be tested
 * independently of browser APIs.
 */
export function shouldEscalateToVision(
  elements: ScreenElement[],
): VisionEscalationDecision {
  const reasons: VisionEscalation[] = [];

  for (const element of elements) {
    switch (element.role) {
      case "canvas":
        reasons.push({
          elementId: element.id,
          reason: "canvas",
        });
        break;

      case "iframe":
        reasons.push({
          elementId: element.id,
          reason: "iframe",
        });
        break;

      case "video":
        reasons.push({
          elementId: element.id,
          reason: "video",
        });
        break;

      case "image":
        if (!element.label?.trim()) {
          reasons.push({
            elementId: element.id,
            reason: "unlabelled-image",
          });
        } else if (element.bbox[2] >= LARGE_IMAGE.width && element.bbox[3] >= LARGE_IMAGE.height) {
          reasons.push({
            elementId: element.id,
            reason: "large-image",
          });
        }
        break;

      default:
        break;
    }
  }

  return {
    shouldEscalate: reasons.length > 0,
    reasons,
  };
}