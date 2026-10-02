import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { hiddenSpans } from "./align.ts";
import { parseGroundTruth, type GroundTruth } from "./ground-truth.ts";
import type { Reading } from "./reading.ts";
import { scoreFixture, summarise } from "./score.ts";

describe("hiddenSpans", () => {
  test("finds what each token replaced", () => {
    assert.deepEqual(hiddenSpans("Deliver to Rahul Sharma, 12 MG Road", "Deliver to <PII:NAME:1>, <PII:ADDRESS:1>"), [
      { start: 11, end: 23, categories: ["NAME"] },
      { start: 25, end: 35, categories: ["ADDRESS"] },
    ]);
  });

  test("handles a token at either end, and none at all", () => {
    assert.deepEqual(hiddenSpans("asha@example.com wrote", "<PII:EMAIL:1> wrote"), [{ start: 0, end: 16, categories: ["EMAIL"] }]);
    assert.deepEqual(hiddenSpans("Call +91 98765 43210", "Call <PII:PHONE:1>"), [{ start: 5, end: 20, categories: ["PHONE"] }]);
    assert.deepEqual(hiddenSpans("Nothing here", "Nothing here"), []);
  });

  test("merges adjacent tokens into one span", () => {
    assert.deepEqual(hiddenSpans("Asha Rao", "<PII:NAME:1><PII:NAME:2>"), [{ start: 0, end: 8, categories: ["NAME", "NAME"] }]);
  });

  test("returns null when the redacted text is not a redaction of the raw one", () => {
    assert.equal(hiddenSpans("Hello there", "Goodbye <PII:NAME:1>"), null);
    assert.equal(hiddenSpans("Hello", "Hello world"), null);
  });
});

const truth: GroundTruth = parseGroundTruth("test.json", {
  page: "test.html",
  about: "A test page.",
  pii: [
    { category: "NAME", value: "Asha Rao", where: "text" },
    { category: "EMAIL", value: "asha@example.com", where: "text" },
    { category: "NAME", value: "Meera Iyer", where: "canvas" },
  ],
  notPii: ["Order #4567890", "Alan Turing"],
});

function reading(pairs: [string, string][]): Reading {
  return {
    raw: { title: "", elements: pairs.map(([label]) => ({ label })) },
    redacted: { title: "", elements: pairs.map(([, label]) => ({ label })) },
    personal: true,
    beyondView: { above: 0, below: 0 },
    timings: { observeMs: 10, visionMs: 0, namesMs: 20, redactMs: 1 },
    nameModel: "on",
  };
}

describe("scoreFixture", () => {
  test("catches an item only when every occurrence is hidden, and counts unseen items apart", () => {
    const score = scoreFixture(truth, reading([
      ["Signed in as Asha Rao", "Signed in as <PII:NAME:1>"],
      ["Asha Rao's orders", "Asha Rao's orders"],
      ["Mail asha@example.com", "Mail <PII:EMAIL:1>"],
    ]));

    const [name, email, canvasName] = score.items;
    assert.equal(name?.caught, false);
    assert.equal(name?.partial, true);
    assert.equal(email?.caught, true);
    assert.equal(email?.categoryRight, true);
    assert.equal(email?.iou, 1);
    assert.equal(canvasName?.seen, false);
  });

  test("finds a value read from pixels despite OCR's slips, and scores it caught when hidden", () => {
    const framed = parseGroundTruth("frame.json", {
      page: "frame.html",
      about: "An email inside a frame.",
      pii: [{ category: "EMAIL", value: "karan.mehta@example.com", where: "iframe" }],
      notPii: [],
    });

    // Tesseract read the dot as a space; the whole of it was hidden.
    const score = scoreFixture(framed, reading([["Email: karan mehta@example.com", "Email: <PII:EMAIL:1>"]]));

    assert.equal(score.items[0]?.seen, true);
    assert.equal(score.items[0]?.caught, true);
    assert.deepEqual(score.falsePositives, []);
  });

  test("still needs the exact value for text in the page itself", () => {
    const score = scoreFixture(truth, reading([["Mail asha example.com", "Mail asha example.com"]]));

    assert.equal(score.items[1]?.seen, false);
  });

  test("counts hidden text that is not PII, and hidden near-misses", () => {
    const score = scoreFixture(truth, reading([
      ["Order #4567890 by Asha Rao", "Order <PII:ACCOUNT:1> by <PII:NAME:1>"],
      ["About Alan Turing", "About Alan Turing"],
    ]));

    assert.deepEqual(score.falsePositives, [{ text: "#4567890", categories: ["ACCOUNT"] }]);
    assert.deepEqual(score.nearMisses, [
      { value: "Order #4567890", seen: true, hidden: true },
      { value: "Alan Turing", seen: true, hidden: false },
    ]);
    assert.equal(score.overRedactedChars, 8);
  });

  test("gives partial credit in IoU when a span is cut short or runs over", () => {
    const score = scoreFixture(truth, reading([["Hi Asha Rao!", "Hi <PII:NAME:1> Rao!"]]));

    assert.equal(score.items[0]?.caught, false);
    assert.equal(score.items[0]?.iou, 4 / 8);
  });
});

describe("summarise", () => {
  test("adds pages up into recall, precision and over-redaction", () => {
    const totals = summarise([
      scoreFixture(truth, reading([["Asha Rao at asha@example.com", "<PII:NAME:1> at <PII:EMAIL:1>"], ["Order #4567890", "Order #4567890"]])),
    ]);

    assert.equal(totals.pii, 3);
    assert.equal(totals.seen, 2);
    assert.equal(totals.recallInText, 1);
    assert.equal(totals.recall, 2 / 3);
    assert.equal(totals.precision, 1);
    assert.equal(totals.overRedaction, 0);
    assert.deepEqual(totals.byLocation.canvas, { pii: 1, caught: 0 });
  });
});

describe("parseGroundTruth", () => {
  test("rejects an unknown category or location", () => {
    assert.throws(() => parseGroundTruth("bad.json", { page: "a.html", about: "x", pii: [{ category: "PET", value: "Rex", where: "text" }], notPii: [] }), /unknown category/);
    assert.throws(() => parseGroundTruth("bad.json", { page: "a.html", about: "x", pii: [{ category: "NAME", value: "Rex", where: "pdf" }], notPii: [] }), /where must be/);
  });
});
