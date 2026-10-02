import { createWorker, type Worker } from "tesseract.js";

import type { VisionInput, VisionTextRegion } from "./types";

const LANG_PATH = "/models/tesseract/";
const CORE_PATH = "/models/tesseract-core/";
const WORKER_PATH = "/models/tesseract/worker.min.js";

/**
 * tesseract.js reports some failures by never settling: if the WASM core fails
 * to start inside its worker (as it did when the manifest's CSP blocked
 * WebAssembly), createWorker() waits forever. So every step gets a deadline.
 */
const START_TIMEOUT_MS = 30_000;
const RECOGNIZE_TIMEOUT_MS = 60_000;

let workerPromise: Promise<Worker> | undefined;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function getWorker(): Promise<Worker> {
  workerPromise ??= withTimeout(
    createWorker("eng", 1, {
      workerPath: WORKER_PATH,
      langPath: LANG_PATH,
      corePath: CORE_PATH,
      workerBlobURL: false,
      gzip: true,
      // The default caches the language model in the extension's IndexedDB.
      // Nothing we run may persist anything, and the file ships in the bundle.
      cacheMethod: "none",
      // Without a handler, a worker error is rethrown where nobody catches it.
      errorHandler: () => {},
    }),
    START_TIMEOUT_MS,
    "Starting the OCR engine",
  ).catch((error: unknown) => {
    workerPromise = undefined; // let the next call try again
    throw error;
  });

  return workerPromise;
}

export async function recognizeText(
  input: VisionInput,
): Promise<VisionTextRegion[]> {
  const worker = await getWorker();
  const result = await withTimeout(
    worker.recognize(input, {}, { text: true, blocks: true }),
    RECOGNIZE_TIMEOUT_MS,
    "Reading text",
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
