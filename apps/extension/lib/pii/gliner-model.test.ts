import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decodeSpans, encodeInput, GlinerRunner, splitWords, type OrtTensorLike } from "./gliner-model.ts";
import { loadNameFinderNode } from "./ner-node.ts";

/** One token per character, so ids and masks are easy to read. */
const fakeTokenizer = {
  encode: (text: string) => ({ ids: text === "<<ENT>>" ? [900] : text === "<<SEP>>" ? [901] : [...text].map((c) => c.charCodeAt(0)) }),
  token_to_id: (token: string) => ({ "[CLS]": 1, "[SEP]": 2, "[PAD]": 0 })[token],
};

/** Logits laid out [words, labels, 3], as raw logits (the decoder applies the sigmoid). */
function logitsFor(words: number, labels: number, set: (word: number, label: number) => [number, number, number]): Float32Array {
  const data = new Float32Array(words * labels * 3).fill(-10);
  for (let w = 0; w < words; w++) {
    for (let l = 0; l < labels; l++) data.set(set(w, l), (w * labels + l) * 3);
  }
  return data;
}

describe("splitWords", () => {
  test("splits like the reference: word runs, joined by - or _, and single other characters", () => {
    assert.deepEqual(splitWords("Hi, Asha-Rao!").map((w) => w.text), ["Hi", ",", "Asha-Rao", "!"]);
    assert.deepEqual(splitWords("Priyā  Nair").map((w) => [w.start, w.end]), [[0, 5], [7, 11]]);
  });
});

describe("encodeInput", () => {
  test("puts the labels first and marks only each word's first token", () => {
    const { inputIds, wordsMask } = encodeInput(["ab", "c"], ["x"], fakeTokenizer);

    // [CLS] <<ENT>> x <<SEP>> a b c [SEP]
    assert.deepEqual(inputIds, [1, 900, 120, 901, 97, 98, 99, 2]);
    assert.deepEqual(wordsMask, [0, 0, 0, 0, 1, 0, 2, 0]);
  });
});

describe("decodeSpans", () => {
  test("joins start, inside and end into a span scored by its weakest part", () => {
    // Label 0 spans words 1..2: start at 1, end at 2, inside both.
    const logits = logitsFor(4, 1, (w) => [w === 1 ? 3 : -10, w === 2 ? 2 : -10, w === 1 || w === 2 ? 1 : -10]);

    const [span] = decodeSpans(logits, 4, 1, 0.5);

    assert.equal(span?.startWord, 1);
    assert.equal(span?.endWord, 2);
    assert.ok(Math.abs(span!.score - 1 / (1 + Math.exp(-1))) < 1e-6);
  });

  test("drops a span whose inside falls below the threshold", () => {
    const logits = logitsFor(3, 1, (w) => [w === 0 ? 3 : -10, w === 2 ? 3 : -10, w === 1 ? -3 : 3]);

    assert.deepEqual(decodeSpans(logits, 3, 1, 0.5), []);
  });

  test("keeps the better of two overlapping spans", () => {
    // Label 0 wants words 0..1, label 1 wants word 1 alone, less surely.
    const logits = logitsFor(2, 2, (w, l) => (l === 0 ? [w === 0 ? 4 : -10, w === 1 ? 4 : -10, 4] : [w === 1 ? 1 : -10, w === 1 ? 1 : -10, 1]));

    const spans = decodeSpans(logits, 2, 2, 0.5);

    assert.equal(spans.length, 1);
    assert.equal(spans[0]?.labelIndex, 0);
  });
});

describe("GlinerRunner", () => {
  test("runs each text on its own, unpadded, and maps spans back to character offsets", async () => {
    const calls: Record<string, OrtTensorLike>[] = [];
    // Marks the last word of every row as a label-0 entity.
    const session = {
      async run(feeds: Record<string, OrtTensorLike>) {
        calls.push(feeds);
        const rows = feeds.text_lengths!.dims[0]!;
        const lengths = [...(feeds.text_lengths!.data as BigInt64Array)].map(Number);
        const words = Math.max(...lengths);
        const data = new Float32Array(rows * words * 1 * 3).fill(-10);
        lengths.forEach((length, row) => data.set([5, 5, 5], (row * words + length - 1) * 3));
        return { logits: { data, dims: [rows, words, 1, 3] } };
      },
    };
    const runner = new GlinerRunner(session, fakeTokenizer, (data, dims) => ({ data, dims }));

    const results = await runner.detect(["Hello Asha", "Bye Rao ."], { labels: ["person"] });

    // Padding rows to a common length changed the scores.
    assert.deepEqual(calls.map((feeds) => feeds.input_ids!.dims[0]), [1, 1]);
    assert.deepEqual(results.map((entities) => entities.map((e) => [e.text, e.start, e.end])), [[["Asha", 6, 10]], [[".", 8, 9]]]);
  });
});

describe("GLiNER on the real model", async () => {
  const findNames = await loadNameFinderNode();

  test("finds names and addresses, and leaves ordinary UI text alone", { skip: findNames ? false : "model not fetched (pnpm models:fetch)" }, async () => {
    const texts = ["Signed in as Asha Rao", "Deliver to Rahul Sharma, 12 MG Road, Bengaluru 560001", "Increment counter", "Order #4567890 ships Friday"];

    const found = await findNames!(texts);

    assert.deepEqual(found[0]!.map((c) => [c.category, c.text]), [["NAME", "Asha Rao"]]);
    assert.deepEqual(found[1]!.map((c) => c.category).sort(), ["ADDRESS", "NAME"]);
    assert.deepEqual(found[2], []);
    assert.deepEqual(found[3], []);
  });
});
