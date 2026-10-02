import { RawImage } from "@huggingface/transformers";
import type { BBox } from "@skrim/schema";
import * as ort from "onnxruntime-web";

import { log } from "@skrim/shared";
import type { VisionBackend, VisionElement, VisionEngine, VisionInput, VisionResult } from "./types.ts";

const MODEL_PATH = "/models/ui-detect/omniparser-icon.onnx";
const IMG_SIZE = 1280;
const CONF_THRESHOLD = 0.15;
const IOU_THRESHOLD = 0.45;

let loading: Promise<IconDetector> | undefined;

function iou(b1: BBox, b2: BBox): number {
  const x1 = Math.max(b1[0], b2[0]);
  const y1 = Math.max(b1[1], b2[1]);
  const x2 = Math.min(b1[0] + b1[2], b2[0] + b2[2]);
  const y2 = Math.min(b1[1] + b1[3], b2[1] + b2[3]);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const intersection = w * h;
  const union = b1[2] * b1[3] + b2[2] * b2[3] - intersection;
  return union > 0 ? intersection / union : 0;
}

export interface OrtSessionLike {
  run(feeds: Record<string, any>): Promise<any>;
  outputNames: readonly string[];
}

export class IconDetector implements VisionEngine {
  constructor(
    private readonly session: OrtSessionLike,
    private readonly backend: VisionBackend
  ) {}

  async analyze(input: VisionInput): Promise<VisionResult> {
    const rawImage = typeof input === "string" 
      ? await RawImage.fromURL(input) 
      : await RawImage.fromBlob(input);

    const rgb = rawImage.channels === 3 ? rawImage : rawImage.rgb();
    const origW = rgb.width;
    const origH = rgb.height;

    // Resize with letterbox padding
    const scale = Math.min(IMG_SIZE / origW, IMG_SIZE / origH);
    const newW = Math.round(origW * scale);
    const newH = Math.round(origH * scale);
    const padX = (IMG_SIZE - newW) / 2;
    const padY = (IMG_SIZE - newH) / 2;

    const resized = await rgb.resize(newW, newH);

    // HWC (RGB) to CHW and pad to IMG_SIZE x IMG_SIZE with 114 (standard YOLO pad)
    const float32Data = new Float32Array(3 * IMG_SIZE * IMG_SIZE).fill(114 / 255.0);
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < newH; y++) {
        for (let x = 0; x < newW; x++) {
          const destIdx = c * IMG_SIZE * IMG_SIZE + Math.floor(y + padY) * IMG_SIZE + Math.floor(x + padX);
          const srcIdx = (y * newW + x) * 3 + c;
          float32Data[destIdx] = resized.data[srcIdx]! / 255.0;
        }
      }
    }

    const tensor = new ort.Tensor("float32", float32Data, [1, 3, IMG_SIZE, IMG_SIZE]);
    const results = await this.session.run({ images: tensor });
    const output = results[this.session.outputNames[0]!].data as Float32Array;

    const numBoxes = 33600; // Output shape [1, 5, 33600]
    const candidates: { bbox: BBox; conf: number }[] = [];

    for (let i = 0; i < numBoxes; i++) {
      const conf = output[4 * numBoxes + i]!;
      if (conf > CONF_THRESHOLD) {
        const cx = output[0 * numBoxes + i]!;
        const cy = output[1 * numBoxes + i]!;
        const w = output[2 * numBoxes + i]!;
        const h = output[3 * numBoxes + i]!;

        const origCx = (cx - padX) / scale;
        const origCy = (cy - padY) / scale;
        // Ignore predictions centered outside the image (in the letterbox margin)
        if (origCx < 0 || origCx >= origW || origCy < 0 || origCy >= origH) continue;

        const origWBox = w / scale;
        const origHBox = h / scale;

        const left = Math.max(0, Math.round(origCx - origWBox / 2));
        const top = Math.max(0, Math.round(origCy - origHBox / 2));
        const right = Math.min(origW, Math.round(origCx + origWBox / 2));
        const bottom = Math.min(origH, Math.round(origCy + origHBox / 2));
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        if (width <= 0 || height <= 0) continue;

        candidates.push({
          bbox: [left, top, width, height],
          conf,
        });
      }
    }

    // Non-Maximum Suppression (NMS)
    candidates.sort((a, b) => b.conf - a.conf);
    const keep: typeof candidates = [];
    for (const cand of candidates) {
      let overlap = false;
      for (const kept of keep) {
        if (iou(cand.bbox, kept.bbox) > IOU_THRESHOLD) {
          overlap = true;
          break;
        }
      }
      if (!overlap) keep.push(cand);
    }

    const elements: VisionElement[] = keep.map((b) => ({
      bbox: b.bbox,
      role: "button",
      confidence: b.conf,
    }));

    log.info("vision.icons", { elements: elements.length, backend: this.backend });

    return {
      elements,
      textRegions: [],
      faces: [],
      backend: this.backend,
    };
  }
}

export function loadIconDetector(): Promise<IconDetector> {
  loading ??= (async () => {
    let session: ort.InferenceSession;
    let backend: VisionBackend = "webgpu";
    try {
      session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ["webgpu"] });
    } catch {
      backend = "wasm";
      session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ["wasm"] });
    }
    return new IconDetector(session, backend);
  })().catch((err: unknown) => {
    loading = undefined;
    throw err;
  });
  return loading;
}
