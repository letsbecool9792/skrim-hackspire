import type {
  BBox,
  ScreenElement,
} from "@skrim/schema";

import type { VisionElement, VisionTextRegion } from "./types";

const IOU_MATCH_THRESHOLD = 0.3;
const CENTER_DISTANCE_FACTOR = 0.75;
const TEXT_MATCH_THRESHOLD = 0.8;
const OCR_CONTAINMENT_THRESHOLD = 0.5;

export interface FusionOptions {
  iouThreshold?: number;
  textMatchThreshold?: number;
}

/**
 * Fuses DOM-derived ScreenElements with local vision output.
 *
 * DOM elements remain authoritative for their existing semantic fields.
 * Vision can upgrade the source to "fused" and provide confidence.
 *
 * Vision-only UI elements are added as new ScreenElements.
 * OCR text is used only for local matching and is never promoted
 * independently into the ScreenElement graph.
 */
export function fuseScreenElements(
  domElements: ScreenElement[],
  visionElements: VisionElement[],
  textRegions: VisionTextRegion[],
  options: FusionOptions = {},
): ScreenElement[] {
  const iouThreshold = options.iouThreshold ?? IOU_MATCH_THRESHOLD;
  const textMatchThreshold =
    options.textMatchThreshold ?? TEXT_MATCH_THRESHOLD;

  const fused = domElements.map((element) => ({ ...element }));

  for (const element of fused) {
    const matchingVision = findMatchingVisionElement(
      element,
      visionElements,
      iouThreshold,
    );

    const matchingText = findMatchingTextRegion(
      element,
      textRegions,
      textMatchThreshold,
    );

    if (matchingVision || matchingText) {
      element.source = "fused";

      if (matchingVision) {
        element.confidence = matchingVision.confidence;
      } else if (matchingText) {
        element.confidence = matchingText.confidence;
      }
    }
  }

  const matchedVision = new Set<VisionElement>();

  for (const domElement of fused) {
    const matchingVision = findMatchingVisionElement(
      domElement,
      visionElements,
      iouThreshold,
    );

    if (matchingVision) {
      matchedVision.add(matchingVision);
    }
  }

  for (const visionElement of visionElements) {
    if (matchedVision.has(visionElement)) {
      continue;
    }

    fused.push({
      id: createVisionElementId(fused),
      role: visionElement.role,
      bbox: visionElement.bbox,
      source: "vision",
      confidence: visionElement.confidence,
    });
  }

  return fused;
}

function findMatchingVisionElement(
  domElement: ScreenElement,
  visionElements: VisionElement[],
  threshold: number,
): VisionElement | undefined {
  let bestMatch: VisionElement | undefined;
  let bestScore = threshold;

  for (const visionElement of visionElements) {
    if (domElement.role !== visionElement.role) {
      continue;
    }

    const score = geometricMatchScore(
      domElement.bbox,
      visionElement.bbox,
    );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = visionElement;
    }
  }

  return bestMatch;
}

function findMatchingTextRegion(
  domElement: ScreenElement,
  textRegions: VisionTextRegion[],
  textThreshold: number,
): VisionTextRegion | undefined {
  const label = normalizeText(domElement.label);

  if (!label) {
    return undefined;
  }

  let bestMatch: VisionTextRegion | undefined;
  let bestScore = textThreshold;

  for (const textRegion of textRegions) {
    const text = normalizeText(textRegion.text);

    if (!text) {
      continue;
    }

    const semanticScore = textSimilarity(label, text);

    if (semanticScore < textThreshold) {
      continue;
    }

    const geometricScore = textGeometricMatchScore(
      domElement.bbox,
      textRegion.bbox,
    );

    if (geometricScore <= 0) {
      continue;
    }

    const score =
      semanticScore * 0.7 +
      geometricScore * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = textRegion;
    }
  }

  return bestMatch;
}

/**
 * Geometry for DOM ↔ vision UI-element matching.
 *
 * IoU is useful when the two boxes represent roughly the same object.
 * Center proximity provides a small fallback for slightly different
 * detector boxes.
 */
function geometricMatchScore(a: BBox, b: BBox): number {
  const intersection = getIntersectionArea(a, b);

  if (intersection > 0) {
    const union = getArea(a) + getArea(b) - intersection;

    if (union > 0) {
      return intersection / union;
    }
  }

  const centerDistance = getCenterDistance(a, b);
  const scale = Math.max(
    Math.min(a[2], a[3]),
    Math.min(b[2], b[3]),
    1,
  );

  return centerDistance <= scale * CENTER_DISTANCE_FACTOR ? 0.1 : 0;
}

/**
 * Geometry for DOM ↔ OCR matching.
 *
 * OCR boxes are normally much smaller than the DOM element containing
 * the text, so IoU alone is insufficient. We therefore measure how
 * much of the OCR box is contained by the DOM box.
 */
function textGeometricMatchScore(a: BBox, b: BBox): number {
  const intersection = getIntersectionArea(a, b);
  const textArea = getArea(b);

  if (intersection <= 0 || textArea <= 0) {
    return 0;
  }

  const textCoverage = intersection / textArea;

  if (textCoverage >= OCR_CONTAINMENT_THRESHOLD) {
    return textCoverage;
  }

  const iou = getIntersectionOverUnion(a, b);

  return iou;
}

function getArea(box: BBox): number {
  return Math.max(0, box[2]) * Math.max(0, box[3]);
}

function getIntersectionArea(a: BBox, b: BBox): number {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(
    a[0] + a[2],
    b[0] + b[2],
  );
  const bottom = Math.min(
    a[1] + a[3],
    b[1] + b[3],
  );

  return (
    Math.max(0, right - left) *
    Math.max(0, bottom - top)
  );
}

function getIntersectionOverUnion(
  a: BBox,
  b: BBox,
): number {
  const intersection = getIntersectionArea(a, b);
  const union =
    getArea(a) +
    getArea(b) -
    intersection;

  return union > 0 ? intersection / union : 0;
}

function getCenterDistance(a: BBox, b: BBox): number {
  const ax = a[0] + a[2] / 2;
  const ay = a[1] + a[3] / 2;
  const bx = b[0] + b[2] / 2;
  const by = b[1] + b[3] / 2;

  return Math.hypot(ax - bx, ay - by);
}

function normalizeText(text: string | undefined): string {
  return (
    text
      ?.trim()
      .replace(/\s+/g, " ")
      .toLowerCase() ?? ""
  );
}

function textSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }

  if (a.includes(b) || b.includes(a)) {
    return 0.9;
  }

  return 0;
}

function createVisionElementId(
  elements: ScreenElement[],
): string {
  let index = elements.length + 1;
  let id = `e${index}`;

  const existingIds = new Set(
    elements.map((element) => element.id),
  );

  while (existingIds.has(id)) {
    index += 1;
    id = `e${index}`;
  }

  return id;
}