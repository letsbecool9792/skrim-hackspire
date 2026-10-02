import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ScreenElement } from "@skrim/schema";

import { fuseScreenElements } from "./fusion";
import type { VisionElement, VisionTextRegion } from "./types";

function domElement(
  overrides: Partial<ScreenElement> = {},
): ScreenElement {
  return {
    id: "e1",
    role: "button",
    label: "Save",
    bbox: [100, 100, 120, 40],
    source: "dom",
    ...overrides,
  };
}

function visionElement(
  overrides: Partial<VisionElement> = {},
): VisionElement {
  return {
    bbox: [102, 102, 116, 36],
    role: "button",
    confidence: 0.95,
    ...overrides,
  };
}

function textRegion(
  overrides: Partial<VisionTextRegion> = {},
): VisionTextRegion {
  return {
    bbox: [110, 108, 60, 20],
    text: "Save",
    confidence: 0.92,
    ...overrides,
  };
}

describe("fuseScreenElements", () => {
  it("marks matching DOM and vision elements as fused", () => {
    const result = fuseScreenElements(
      [domElement()],
      [visionElement()],
      [],
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "e1");
    assert.equal(result[0]?.source, "fused");
    assert.equal(result[0]?.confidence, 0.95);
  });

  it("keeps DOM-only elements as dom", () => {
    const result = fuseScreenElements(
      [domElement()],
      [],
      [],
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]?.source, "dom");
  });

  it("adds unmatched vision elements as vision", () => {
    const result = fuseScreenElements(
      [],
      [visionElement()],
      [],
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]?.source, "vision");
    assert.equal(result[0]?.role, "button");
    assert.equal(result[0]?.confidence, 0.95);
  });

  it("uses OCR text to fuse a DOM element", () => {
    const result = fuseScreenElements(
      [domElement()],
      [],
      [textRegion()],
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]?.source, "fused");
  });

  it("matches OCR text case-insensitively and across whitespace", () => {
    const result = fuseScreenElements(
      [domElement({ label: "  Save  Changes " })],
      [],
      [
        textRegion({
          text: "save changes",
          bbox: [105, 105, 100, 25],
        }),
      ],
    );

    assert.equal(result[0]?.source, "fused");
  });

  it("does not fuse unrelated OCR text", () => {
    const result = fuseScreenElements(
      [domElement()],
      [],
      [
        textRegion({
          text: "Cancel",
          bbox: [500, 500, 60, 20],
        }),
      ],
    );

    assert.equal(result[0]?.source, "dom");
  });

  it("does not fuse vision elements with a different role", () => {
    const result = fuseScreenElements(
      [domElement({ role: "button" })],
      [
        visionElement({
          role: "textbox",
        }),
      ],
      [],
    );

    assert.equal(result.length, 2);
    assert.equal(result[0]?.source, "dom");
    assert.equal(result[1]?.source, "vision");
  });

  it("preserves DOM children when fusing", () => {
    const result = fuseScreenElements(
      [
        domElement({
          children: ["e2"],
        }),
      ],
      [visionElement()],
      [],
    );

    assert.deepEqual(result[0]?.children, ["e2"]);
    assert.equal(result[0]?.source, "fused");
  });

  it("does not expose OCR text as a new screen element", () => {
    const result = fuseScreenElements(
      [],
      [],
      [textRegion()],
    );

    assert.equal(result.length, 0);
  });
});