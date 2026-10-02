import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ScreenElement } from "@skrim/schema";

import { shouldEscalateToVision } from "./escalation";

function element(
  overrides: Partial<ScreenElement> = {},
): ScreenElement {
  return {
    id: "e1",
    role: "button",
    bbox: [0, 0, 100, 40],
    source: "dom",
    ...overrides,
  };
}

describe("shouldEscalateToVision", () => {
  it("does not escalate for ordinary DOM elements", () => {
    const result = shouldEscalateToVision([
      element({ role: "button" }),
      element({ id: "e2", role: "textbox" }),
      element({ id: "e3", role: "heading" }),
    ]);

    assert.equal(result.shouldEscalate, false);
    assert.deepEqual(result.reasons, []);
  });

  it("escalates for canvas", () => {
    const result = shouldEscalateToVision([
      element({
        id: "e7",
        role: "canvas",
      }),
    ]);

    assert.equal(result.shouldEscalate, true);
    assert.deepEqual(result.reasons, [
      {
        elementId: "e7",
        reason: "canvas",
      },
    ]);
  });

  it("escalates for iframe", () => {
    const result = shouldEscalateToVision([
      element({
        id: "e3",
        role: "iframe",
      }),
    ]);

    assert.equal(result.shouldEscalate, true);
    assert.deepEqual(result.reasons, [
      {
        elementId: "e3",
        reason: "iframe",
      },
    ]);
  });

  it("escalates for video", () => {
    const result = shouldEscalateToVision([
      element({
        id: "e5",
        role: "video",
      }),
    ]);

    assert.equal(result.shouldEscalate, true);
    assert.deepEqual(result.reasons, [
      {
        elementId: "e5",
        reason: "video",
      },
    ]);
  });

  it("escalates for an image without a label", () => {
    const result = shouldEscalateToVision([
      element({
        id: "e9",
        role: "image",
      }),
    ]);

    assert.equal(result.shouldEscalate, true);
    assert.deepEqual(result.reasons, [
      {
        elementId: "e9",
        reason: "unlabelled-image",
      },
    ]);
  });

  it("does not escalate for a labelled image", () => {
    const result = shouldEscalateToVision([
      element({
        id: "e9",
        role: "image",
        label: "Product photo",
      }),
    ]);

    assert.equal(result.shouldEscalate, false);
    assert.deepEqual(result.reasons, []);
  });

  it("reports all escalation reasons in one pass", () => {
    const result = shouldEscalateToVision([
      element({ id: "e1", role: "button" }),
      element({ id: "e2", role: "canvas" }),
      element({ id: "e3", role: "iframe" }),
      element({ id: "e4", role: "video" }),
      element({ id: "e5", role: "image" }),
    ]);

    assert.equal(result.shouldEscalate, true);
    assert.deepEqual(result.reasons, [
      {
        elementId: "e2",
        reason: "canvas",
      },
      {
        elementId: "e3",
        reason: "iframe",
      },
      {
        elementId: "e4",
        reason: "video",
      },
      {
        elementId: "e5",
        reason: "unlabelled-image",
      },
    ]);
  });
});