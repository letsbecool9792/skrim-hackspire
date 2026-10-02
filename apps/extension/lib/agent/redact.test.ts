import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ScreenElement } from "@skrim/schema";

import type { PageObservationMessage } from "../messages.ts";
import { TokenVault } from "../vault/vault.js";
import { redactPage } from "./redact.ts";

/**
 * Redacting a page view where some text was read from pixels: an ID card shown
 * as an image, an email inside a cross-origin frame. The OCR lines follow the
 * element they were read from, as lib/vision/read-pixels.ts inserts them.
 */

type Line = { label: string; source?: ScreenElement["source"]; role?: ScreenElement["role"] };

function observation(...lines: Line[]): PageObservationMessage {
  const elements: ScreenElement[] = lines.map((line, index) => ({ id: `e${index + 1}`, role: line.role ?? "text", label: line.label, bbox: [0, index * 30, 300, 24], source: line.source ?? "dom" }));
  return { type: "page.observation", taskId: "t", observationVersion: 0, elementCount: elements.length, hasVisualCapture: false, graphAvailable: true, elements };
}

const labels = (observed: PageObservationMessage) => redactPage(observed, 0, new TokenVault()).graph.elements.map((element) => element.label);

describe("redactPage on text read from pixels", () => {
  test("hides an Aadhaar number read from an image of an ID card, with no label of its own", () => {
    const view = observation(
      { label: "Uploaded ID card", role: "image" },
      { label: "Rahul Sharma", source: "vision" },
      { label: "DOB 05/11/1988", source: "vision" },
      { label: "1234 5678 9012", source: "vision" },
    );

    assert.equal(labels(view)[3], "<PII:GOV_ID:1>");
  });

  test("still reads the line before as a label, as on a card that prints \"Aadhaar No.\" above the number", () => {
    const view = observation(
      { label: "Photo", role: "image" },
      { label: "Aadhaar No.", source: "vision" },
      { label: "1234 5678 9012", source: "vision" },
    );

    assert.equal(labels(view)[2], "<PII:GOV_ID:1>");
  });

  test("hides the whole email when OCR read its dot as a space, leaving no part of the name", () => {
    // What Tesseract made of the iframe fixture in Chromium (pnpm eval -- --show-text iframe-form.html).
    for (const read of ["Email: karan mehta@example.com", "Email: karan. mehta@example.com"]) {
      const view = observation({ label: "Identity details", role: "iframe" }, { label: read, source: "vision" });

      const label = labels(view)[1] ?? "";
      assert.equal(label, "Email: <PII:EMAIL:1>");
      assert.doesNotMatch(label, /karan/);
    }
  });

  test("leaves a 4-4-4 number on a page readable when nothing labels it as an ID", () => {
    const view = observation({ label: "Order reference" }, { label: "7789 5561 2230" });

    assert.equal(labels(view)[1], "7789 5561 2230");
  });
});
