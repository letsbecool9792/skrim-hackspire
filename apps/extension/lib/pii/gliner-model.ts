import type { GlinerEntity } from "./gliner.js";

/**
 * Runs GLiNER (knowledgator/gliner-pii-edge-v1.0) to find names and addresses
 * in free text, which no regex can do.
 *
 * GLiNER is not a Transformers.js pipeline, so this does its pre- and
 * post-processing by hand, following the reference implementation's
 * token-level mode (gliner/data_processing, TokenDecoder):
 *   input  = [CLS] <<ENT>> label ... <<SEP>> word word ... [SEP]
 *   output = per word, per label: start / end / inside logits
 *
 * It depends only on the shapes below, so the extension runs it on
 * onnxruntime-web and tests run the same code on onnxruntime-node.
 */

export interface OrtTensorLike {
  readonly data: unknown;
  readonly dims: readonly number[];
}

export interface OrtSessionLike {
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>;
}

export type Int64TensorFactory = (data: BigInt64Array, dims: number[]) => OrtTensorLike;

export interface TokenizerLike {
  encode(text: string, options?: { add_special_tokens?: boolean }): { ids: number[] };
  token_to_id(token: string): number | undefined;
}

export interface Word {
  text: string;
  start: number;
  end: number;
}

/**
 * The reference "whitespace" splitter: runs of word characters (joined by -
 * or _), or any single other visible character.
 */
const WORD_PATTERN = /[\p{L}\p{N}_]+(?:[-_][\p{L}\p{N}_]+)*|\S/gu;

export function splitWords(text: string): Word[] {
  return [...text.matchAll(WORD_PATTERN)].map((match) => ({
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

export interface EncodedInput {
  inputIds: number[];
  /** 0 for special and prompt tokens; for a word's first sub-token, its 1-based word index. */
  wordsMask: number[];
}

function specialId(tokenizer: TokenizerLike, token: string): number {
  const id = tokenizer.token_to_id(token);
  if (id === undefined) throw new Error(`GLiNER tokenizer has no ${token} token`);
  return id;
}

export function encodeInput(words: readonly string[], labels: readonly string[], tokenizer: TokenizerLike): EncodedInput {
  const inputIds = [specialId(tokenizer, "[CLS]")];
  const wordsMask = [0];
  const push = (text: string, wordIndex: number) => {
    const ids = tokenizer.encode(text, { add_special_tokens: false }).ids;
    ids.forEach((id, position) => {
      inputIds.push(id);
      wordsMask.push(position === 0 ? wordIndex : 0);
    });
  };
  for (const label of labels) {
    push("<<ENT>>", 0);
    push(label, 0);
  }
  push("<<SEP>>", 0);
  words.forEach((word, index) => push(word, index + 1));
  inputIds.push(specialId(tokenizer, "[SEP]"));
  wordsMask.push(0);
  return { inputIds, wordsMask };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export interface WordSpan {
  startWord: number;
  endWord: number;
  labelIndex: number;
  score: number;
}

/**
 * Turns the model's logits into word spans. `logits` is laid out
 * [1, words, labels, 3] with start, end and inside scores last. A span needs a
 * start and an end above the threshold, and every word inside it above the
 * threshold too; its score is the lowest of those, as in the reference decoder.
 * Overlapping spans are then resolved greedily, best score first.
 */
export function decodeSpans(logits: Float32Array, wordCount: number, labelCount: number, threshold: number): WordSpan[] {
  const at = (word: number, label: number, kind: 0 | 1 | 2) => sigmoid(logits[(word * labelCount + label) * 3 + kind]!);
  const spans: WordSpan[] = [];
  for (let label = 0; label < labelCount; label++) {
    for (let start = 0; start < wordCount; start++) {
      const startScore = at(start, label, 0);
      if (startScore <= threshold) continue;
      let lowestInside = Infinity;
      for (let end = start; end < wordCount; end++) {
        lowestInside = Math.min(lowestInside, at(end, label, 2));
        if (lowestInside < threshold) break;
        const endScore = at(end, label, 1);
        if (endScore <= threshold) continue;
        spans.push({ startWord: start, endWord: end, labelIndex: label, score: Math.min(lowestInside, startScore, endScore) });
      }
    }
  }
  spans.sort((a, b) => b.score - a.score);
  const accepted: WordSpan[] = [];
  for (const span of spans) {
    if (accepted.some((other) => span.startWord <= other.endWord && span.endWord >= other.startWord)) continue;
    accepted.push(span);
  }
  return accepted.sort((a, b) => a.startWord - b.startWord);
}

/** Longest piece of one text the model sees at once; longer texts are split. */
const MAX_WORDS = 256;
/**
 * Texts per model call: one. Packing several texts into one sequence cost
 * most of the recall on names. Batching them as padded rows
 * made each text's scores depend on its neighbours ("Signed in as Priya":
 * 0.64 alone, 0.44 in a batch; the brand "Skrim" crossed 0.6 as a person in
 * one batch and not another), and on ONNX Runtime's WASM it was no faster.
 */
const BATCH_SIZE = 1;

interface Item {
  text: number;
  words: Word[];
}

function toItems(texts: readonly string[]): Item[] {
  const items: Item[] = [];
  texts.forEach((text, index) => {
    const words = splitWords(text);
    for (let offset = 0; offset < words.length; offset += MAX_WORDS) {
      items.push({ text: index, words: words.slice(offset, offset + MAX_WORDS) });
    }
  });
  return items;
}

export interface GlinerOptions {
  /** What to look for, in plain words: "person", "address". */
  labels: readonly string[];
  /** 0-1. The reference default is 0.5. */
  threshold?: number;
}

export class GlinerRunner {
  private readonly padId: number;

  constructor(
    private readonly session: OrtSessionLike,
    private readonly tokenizer: TokenizerLike,
    private readonly int64: Int64TensorFactory,
  ) {
    this.padId = specialId(tokenizer, "[PAD]");
  }

  /** Entities for each text, with character offsets into that text. */
  async detect(texts: readonly string[], options: GlinerOptions): Promise<GlinerEntity[][]> {
    const threshold = options.threshold ?? 0.5;
    const labelCount = options.labels.length;
    const results: GlinerEntity[][] = texts.map(() => []);
    const items = toItems(texts);

    for (let first = 0; first < items.length; first += BATCH_SIZE) {
      const batch = items.slice(first, first + BATCH_SIZE);
      const encoded = batch.map((item) => encodeInput(item.words.map((word) => word.text), options.labels, this.tokenizer));
      const rows = batch.length;
      const length = Math.max(...encoded.map((input) => input.inputIds.length));
      const inputIds = new BigInt64Array(rows * length).fill(BigInt(this.padId));
      const attention = new BigInt64Array(rows * length);
      const wordsMask = new BigInt64Array(rows * length);
      encoded.forEach((input, row) => {
        input.inputIds.forEach((id, i) => {
          inputIds[row * length + i] = BigInt(id);
          attention[row * length + i] = 1n;
          wordsMask[row * length + i] = BigInt(input.wordsMask[i]!);
        });
      });

      const output = await this.session.run({
        input_ids: this.int64(inputIds, [rows, length]),
        attention_mask: this.int64(attention, [rows, length]),
        words_mask: this.int64(wordsMask, [rows, length]),
        text_lengths: this.int64(BigInt64Array.from(batch, (item) => BigInt(item.words.length)), [rows, 1]),
      });
      const logits = output.logits;
      if (!logits || !(logits.data instanceof Float32Array)) throw new Error("GLiNER returned no logits");
      // [rows, words in the longest row, labels, 3]
      const rowStride = (logits.dims[1] ?? 0) * labelCount * 3;

      batch.forEach((item, row) => {
        const rowLogits = logits.data as Float32Array;
        const own = rowLogits.subarray(row * rowStride, row * rowStride + item.words.length * labelCount * 3);
        const text = texts[item.text]!;
        for (const span of decodeSpans(own, item.words.length, labelCount, threshold)) {
          const start = item.words[span.startWord]!.start;
          const end = item.words[span.endWord]!.end;
          results[item.text]!.push({ text: text.slice(start, end), label: options.labels[span.labelIndex]!, start, end, score: span.score });
        }
      });
    }
    return results;
  }
}
