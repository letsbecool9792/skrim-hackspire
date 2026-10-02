import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import type { VisionFace } from "./types.js";

const WASM_DIR = "/models/mediapipe-wasm";
const MODEL_PATH = "/models/face/blaze_face_short_range.tflite";

let detectorInstance: FaceDetector | undefined;
let loading: Promise<FaceDetector> | undefined;

export async function getFaceDetector(): Promise<FaceDetector> {
  if (detectorInstance) return detectorInstance;
  if (loading) return loading;
  loading = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_DIR);
    const detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
    });
    detectorInstance = detector;
    return detector;
  })();
  return loading;
}

/**
 * An image is big enough to hold a face if it's at least 32x32 pixels.
 */
export function isBigEnoughForFace(width: number, height: number): boolean {
  return width >= 32 && height >= 32;
}

/**
 * Detects faces in an image element. Returns an empty array if the image
 * is too small, avoiding loading the model entirely.
 */
export async function detectFaces(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap | ImageData,
  width: number,
  height: number
): Promise<VisionFace[]> {
  if (!isBigEnoughForFace(width, height)) {
    return [];
  }

  const detector = await getFaceDetector();
  const results = detector.detect(image);

  return (results.detections ?? [])
    .map((det) => {
      const box = det.boundingBox;
      if (!box) return null;
      return {
        bbox: [box.originX, box.originY, box.width, box.height] as [number, number, number, number],
        confidence: det.categories?.[0]?.score ?? 1.0,
      };
    })
    .filter((f): f is VisionFace => f !== null);
}
