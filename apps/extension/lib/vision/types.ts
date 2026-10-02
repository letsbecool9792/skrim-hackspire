import type { BBox, ElementRole } from "@skrim/schema";

/**
 * A UI element detected from pixels by a vision model.
 *
 * This is local/intermediate vision output. It becomes a ScreenElement
 * during the DOM + vision fusion stage.
 */
export interface VisionElement {
  bbox: BBox;
  role: ElementRole;
  confidence: number;
}

/**
 * A text region detected from pixels.
 *
 * This is LOCAL intermediate data. Raw text must pass through the
 * Workstream 3 privacy pipeline before it can enter a ScreenElement
 * or ScreenGraph.
 */
export interface VisionTextRegion {
  bbox: BBox;
  text: string;
  confidence: number;
}

/**
 * A face detected in the screenshot.
 *
 * Face detection is performed locally. The actual face pixels are never
 * represented here as a network payload.
 */
export interface VisionFace {
  bbox: BBox;
  confidence: number;
}

/**
 * The inference backend actually used by the vision runtime.
 */
export type VisionBackend = "webgpu" | "wasm";

/**
 * The combined result of a local vision pass.
 */
export interface VisionResult {
  elements: VisionElement[];
  textRegions: VisionTextRegion[];
  faces: VisionFace[];
  backend: VisionBackend;
}

/**
 * Input accepted by a vision engine.
 *
 * The screenshot remains in memory as a data URL; this interface does not
 * introduce any persistent image-storage mechanism.
 */
export type VisionInput = string | Blob;

/**
 * Model-agnostic interface for local vision inference.
 */
export interface VisionEngine {
  analyze(input: VisionInput): Promise<VisionResult>;
}