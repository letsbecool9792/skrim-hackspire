import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isBigEnoughForFace } from "./face-detector.js";

describe("isBigEnoughForFace", () => {
  test("returns true for images 32x32 and larger", () => {
    assert.equal(isBigEnoughForFace(32, 32), true);
    assert.equal(isBigEnoughForFace(100, 200), true);
  });

  test("returns false for images smaller than 32x32", () => {
    assert.equal(isBigEnoughForFace(31, 32), false);
    assert.equal(isBigEnoughForFace(32, 31), false);
    assert.equal(isBigEnoughForFace(10, 10), false);
  });
});
