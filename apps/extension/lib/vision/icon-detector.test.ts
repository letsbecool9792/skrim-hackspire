import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as ortNode from "onnxruntime-node";
import { IconDetector } from "./icon-detector.ts";

const MODEL_PATH = fileURLToPath(
  new URL("../../public/models/ui-detect/omniparser-icon.onnx", import.meta.url)
);
const TEST_IMAGE_PATH = fileURLToPath(
  new URL("../../../../fixtures/pages/assets/icon-detector.png", import.meta.url)
);

test("OmniParser icon detector", { skip: existsSync(MODEL_PATH) ? false : "model not fetched (pnpm models:fetch)" }, async () => {
  // Use onnxruntime-node instead of web in Node test environment
  const session = await ortNode.InferenceSession.create(MODEL_PATH);

  const detector = new IconDetector(session as any, "wasm");

  const imageData = await readFile(TEST_IMAGE_PATH);
  const imageBlob = new Blob([imageData], { type: "image/png" });

  const result = await detector.analyze(imageBlob);

  assert.equal(result.backend, "wasm");
  assert.ok(Array.isArray(result.elements), "elements should be an array");
  assert.ok(result.elements.length > 0, `expected at least one detection, got ${result.elements.length}`);

  for (const el of result.elements) {
    assert.ok(Array.isArray(el.bbox), "bbox should be an array");
    assert.equal(el.bbox.length, 4, "bbox should have 4 coordinates [x, y, w, h]");
    const [x, y, w, h] = el.bbox;
    assert.ok(x >= 0 && y >= 0, `box coords should be non-negative: [${x}, ${y}]`);
    assert.ok(w > 0 && h > 0, `box dimensions should be positive: [${w}, ${h}]`);
    assert.ok(el.confidence > 0 && el.confidence <= 1.0, "confidence should be between 0 and 1");
    assert.equal(el.role, "button", "role should be button");
  }
});
