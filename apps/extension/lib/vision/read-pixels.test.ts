import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ScreenElement } from "@skrim/schema";

import { pixelTargets, withPixelText } from "./read-pixels.ts";

const element = (id: string, role: ScreenElement["role"], bbox: ScreenElement["bbox"], extra: Partial<ScreenElement> = {}): ScreenElement => ({ id, role, bbox, source: "dom", ...extra });

describe("pixelTargets", () => {
  test("reads canvases, frames and big images in view, largest first, and nothing else", () => {
    const targets = pixelTargets([
      element("e1", "button", [0, 0, 100, 40]),
      element("e2", "canvas", [0, 50, 420, 200]),
      element("e3", "image", [0, 300, 420, 220], { label: "Uploaded ID card" }),
      element("e4", "image", [0, 600, 32, 32], { label: "Logo" }),
      element("e5", "iframe", [0, 700, 600, 160], { state: ["offscreen"] }),
      element("e6", "video", [0, 900, 640, 360]),
    ]);

    assert.deepEqual(targets.map((target) => target.id), ["e3", "e2"]);
  });
});

describe("withPixelText", () => {
  test("puts each line read after the element it came from, under new ids, and drops unsure lines", () => {
    const elements = withPixelText(
      [element("e1", "heading", [0, 0, 200, 30], { label: "Your digital ID" }), element("e2", "canvas", [0, 40, 420, 200]), element("e3", "button", [0, 250, 100, 40], { label: "Download PDF" })],
      [
        { targetId: "e2", bbox: [24, 80, 90, 20], text: "Asha Rao", confidence: 0.93 },
        { targetId: "e2", bbox: [24, 120, 140, 20], text: "DOB 12/03/1994", confidence: 0.9 },
        { targetId: "e2", bbox: [24, 160, 40, 20], text: "~~", confidence: 0.2 },
      ],
    );

    assert.deepEqual(elements.map((e) => [e.id, e.role, e.label, e.source]), [
      ["e1", "heading", "Your digital ID", "dom"],
      ["e2", "canvas", undefined, "dom"],
      ["e4", "text", "Asha Rao", "vision"],
      ["e5", "text", "DOB 12/03/1994", "vision"],
      ["e3", "button", "Download PDF", "dom"],
    ]);
  });
});
