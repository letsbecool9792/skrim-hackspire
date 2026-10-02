import { createWorker, type Worker } from "tesseract.js";

import type { VisionInput, VisionTextRegion } from "./types";

const LANG_PATH = "/models/tesseract/";
const CORE_PATH = "/models/tesseract-core/";
const WORKER_PATH = "/models/tesseract/worker.min.js";

let workerPromise: Promise<Worker> | undefined;

async function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker("eng", 1, {
    workerPath: WORKER_PATH,
    langPath: LANG_PATH,
    corePath: CORE_PATH,
    workerBlobURL: false,
    gzip: true,
  });

  return workerPromise;
}

export async function recognizeText(
  input: VisionInput,
): Promise<VisionTextRegion[]> {
  const worker = await getWorker();
  const result = await worker.recognize(
  input,
  {},
  {
    text: true,
    blocks: true,
  },
);

  return (result.data.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines)
    .flatMap((line) => line.words)
    .filter((word) => word.text.trim().length > 0)
    .map((word) => ({
      bbox: [
        word.bbox.x0,
        word.bbox.y0,
        word.bbox.x1 - word.bbox.x0,
        word.bbox.y1 - word.bbox.y0,
      ],
      text: word.text,
      confidence: word.confidence / 100,
    }));
}

export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) {
    return;
  }

  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = undefined;
}