import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Tokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";

import { createNameFinder, type NameFinder } from "./gliner.js";
import { GlinerRunner, type OrtSessionLike } from "./gliner-model.ts";

/**
 * NODE ONLY, for tests and scripts: the same GLiNER code as the extension, on
 * onnxruntime-node. Never imported by an entrypoint.
 *
 * Returns null when the model has not been fetched (`pnpm models:fetch`), as
 * in CI, so callers can skip instead of fail.
 */
const MODEL_DIR = fileURLToPath(new URL("../../public/models/gliner-pii/", import.meta.url));

export async function loadNameFinderNode(): Promise<NameFinder | null> {
  const model = `${MODEL_DIR}model_quint8.onnx`;
  if (!existsSync(model)) return null;
  const json = (name: string) => JSON.parse(readFileSync(`${MODEL_DIR}${name}`, "utf8")) as object;
  const session = await ort.InferenceSession.create(model);
  const runner = new GlinerRunner(
    session as unknown as OrtSessionLike,
    new Tokenizer(json("tokenizer.json"), json("tokenizer_config.json")),
    (data, dims) => new ort.Tensor("int64", data, dims),
  );
  return createNameFinder(runner);
}
