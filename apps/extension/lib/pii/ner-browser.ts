import { Tokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-web/wasm";

import { createNameFinder, type NameFinder } from "./gliner.js";
import { GlinerRunner, type OrtSessionLike } from "./gliner-model.ts";

/**
 * Loads GLiNER in an extension page (the side panel), once. Everything comes
 * from inside the extension: `pnpm models:fetch` puts the model and tokenizer
 * in public/models/, and Vite bundles ONNX Runtime's WebAssembly as an asset
 * (onnxruntime-web/wasm points at it with new URL(..., import.meta.url)). MV3
 * forbids loading code from a CDN, and the air-gap demo needs no network.
 *
 * Plain WebAssembly on one thread: extension pages are not cross-origin
 * isolated, so there is no SharedArrayBuffer for threads. The model is small
 * (32M parameters) and each page view is one or two batched calls.
 */

const MODEL_DIR = "/models/gliner-pii/";

let loading: Promise<NameFinder> | undefined;

async function fetchJson(path: string): Promise<object> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}. Run pnpm models:fetch and rebuild.`);
  return (await response.json()) as object;
}

export function loadNameFinder(): Promise<NameFinder> {
  loading ??= (async () => {
    ort.env.wasm.numThreads = 1;
    const [tokenizerJson, tokenizerConfig] = await Promise.all([
      fetchJson(`${MODEL_DIR}tokenizer.json`),
      fetchJson(`${MODEL_DIR}tokenizer_config.json`),
    ]);
    const session = await ort.InferenceSession.create(`${MODEL_DIR}model_quint8.onnx`, { executionProviders: ["wasm"] });
    const runner = new GlinerRunner(
      session as unknown as OrtSessionLike,
      new Tokenizer(tokenizerJson, tokenizerConfig),
      (data, dims) => new ort.Tensor("int64", data, dims),
    );
    return createNameFinder(runner);
  })().catch((error: unknown) => {
    loading = undefined; // let a later task try again
    throw error;
  });
  return loading;
}
