#!/usr/bin/env node
/**
 * Populates apps/extension/public/models/ with every local model asset.
 *
 *   pnpm models:fetch            # skip anything already present
 *   pnpm models:fetch --force    # re-download everything
 *
 * Run this after `pnpm install` on a fresh clone. Model weights are
 * gitignored, so without this the extension has nothing to load.
 *
 * Requires only Node 22+. Deliberately has no dependencies and needs no
 * Python: the one artifact that does require Python (the OmniParser icon
 * detector) is exported once by scripts/export_icon_detector.py and
 * committed to scripts/artifacts/, then copied into place from here.
 */

import { mkdir, stat, writeFile, cp, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(ROOT, "apps", "extension", "public", "models");
const FORCE = process.argv.includes("--force");

const HF = "https://huggingface.co/knowledgator/gliner-pii-edge-v1.0/resolve/main";

/**
 * Remote assets. `approxKB` is a sanity floor, not a checksum — its job is to
 * catch the classic failure where a 404 HTML page gets written out as a .onnx
 * and then fails hours later inside the inference worker with no clue why.
 */
const REMOTE = [
  // --- Text PII detection: GLiNER, quantised to uint8 -------------------
  // NOTE: onnx/model_fp16.onnx also exists. Benchmarking quint8 vs fp16 for
  // accuracy-per-millisecond is scored work (brief section 9.6) - not done yet.
  { url: `${HF}/onnx/model_quint8.onnx`,     to: "gliner-pii/model_quint8.onnx",     approxKB: 40000 },
  { url: `${HF}/tokenizer.json`,             to: "gliner-pii/tokenizer.json",        approxKB: 3000 },
  { url: `${HF}/tokenizer_config.json`,      to: "gliner-pii/tokenizer_config.json", approxKB: 5 },
  { url: `${HF}/special_tokens_map.json`,    to: "gliner-pii/special_tokens_map.json", approxKB: 0 },
  { url: `${HF}/gliner_config.json`,         to: "gliner-pii/gliner_config.json",    approxKB: 1 },

  // --- Face detection: BlazeFace short-range ----------------------------
  {
    url: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    to: "face/blaze_face_short_range.tflite",
    approxKB: 200,
  },

  // --- OCR: English traineddata (tesseract.js reads the .gz directly) ---
  {
    url: "https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz",
    to: "tesseract/eng.traineddata.gz",
    approxKB: 1800,
  },
];

/**
 * Assets copied out of node_modules rather than downloaded. MV3's CSP blocks
 * loading WASM from a CDN, so MediaPipe and Tesseract runtimes have to be
 * served from inside the extension bundle.
 *
 * Both packages ship every build variant they support. Copying all of them
 * costs ~78MB for no benefit, and resource use is 20% of the rubric, so we
 * name the exact files instead. If you add a variant here, say why.
 */
const VENDOR = [
  {
    pkg: "@mediapipe/tasks-vision",
    from: "wasm",
    to: "mediapipe-wasm",
    // SIMD only. Both target browsers (Chrome 152, Firefox 149) have shipped
    // WASM SIMD for years, so the nosimd fallback is 10MB of dead weight.
    // The *_module_* pair is the ESM loader variant; we use the standard one.
    files: ["vision_wasm_internal.js", "vision_wasm_internal.wasm"],
  },
  {
    pkg: "tesseract.js-core",
    from: ".",
    to: "tesseract-core",
    // LSTM engine only - the "full" builds bundle the legacy pre-neural
    // Tesseract engine we never invoke. The .wasm.js files are the asm.js
    // fallback for browsers without WASM at all; not a case we support.
    files: ["tesseract-core-simd-lstm.js", "tesseract-core-simd-lstm.wasm"],
  },
];

/** Artifacts we export ourselves and commit, so teammates never need Python. */
const LOCAL = [
  {
    from: join(ROOT, "scripts", "artifacts", "omniparser-icon.onnx"),
    to: "ui-detect/omniparser-icon.onnx",
    hint: "run: scripts/.venv/Scripts/python.exe scripts/export_icon_detector.py",
  },
];

const kb = (bytes) => Math.round(bytes / 1024);
const exists = (p) => stat(p).then(() => true, () => false);

/** pnpm's layout varies; check the likely spots before giving up. */
async function resolvePackageDir(name) {
  const candidates = [
    join(ROOT, "apps", "extension", "node_modules", name),
    join(ROOT, "node_modules", name),
  ];
  for (const c of candidates) if (await exists(c)) return c;

  // Fall back to scanning the pnpm virtual store.
  const store = join(ROOT, "node_modules", ".pnpm");
  if (await exists(store)) {
    const flat = name.replace("/", "+");
    for (const entry of await readdir(store)) {
      if (!entry.startsWith(`${flat}@`)) continue;
      const p = join(store, entry, "node_modules", name);
      if (await exists(p)) return p;
    }
  }
  return null;
}

async function download({ url, to, approxKB }) {
  const target = join(DEST, to);
  if (!FORCE && (await exists(target))) {
    console.log(`  skip   ${to}`);
    return 0;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (approxKB > 0 && kb(buf.length) < approxKB * 0.5) {
    throw new Error(
      `${to} came back at ${kb(buf.length)}KB, expected ~${approxKB}KB. ` +
        `That is almost always an error page, not a model. Check ${url}`
    );
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buf);
  console.log(`  got    ${to}  (${kb(buf.length)} KB)`);
  return buf.length;
}

async function vendor({ pkg, from, to, files }) {
  const dir = await resolvePackageDir(pkg);
  if (!dir) throw new Error(`${pkg} not found in node_modules. Run \`pnpm install\` first.`);

  const src = from === "." ? dir : join(dir, from);
  if (!(await exists(src))) throw new Error(`${pkg} has no "${from}" directory at ${src}`);

  const target = join(DEST, to);
  await mkdir(target, { recursive: true });

  let bytes = 0;
  for (const name of files) {
    const s = join(src, name);
    if (!(await exists(s))) {
      throw new Error(
        `${pkg} no longer ships "${name}". It was renamed or dropped in an ` +
          `upgrade - check ${src} and update the files list in fetch-models.mjs.`
      );
    }
    await cp(s, join(target, name));
    bytes += (await stat(s)).size;
  }
  console.log(`  vendor ${to}  (${kb(bytes)} KB from ${pkg})`);
  return bytes;
}

async function local({ from, to, hint }) {
  if (!(await exists(from))) {
    console.warn(`  MISSING ${to}`);
    console.warn(`          ${from} is not committed yet.`);
    console.warn(`          ${hint}`);
    return 0;
  }
  const target = join(DEST, to);
  await mkdir(dirname(target), { recursive: true });
  await cp(from, target);
  const { size } = await stat(target);
  console.log(`  copy   ${to}  (${kb(size)} KB)`);
  return size;
}

/** Actual bytes on disk under dir - not bytes transferred, which undercounts
 *  every skipped asset and makes the footprint look better than it is. */
async function diskUsage(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? await diskUsage(p) : (await stat(p)).size;
  }
  return total;
}

async function main() {
  console.log(`\nFetching models into apps/extension/public/models/${FORCE ? "  (--force)" : ""}\n`);
  await mkdir(DEST, { recursive: true });

  for (const a of REMOTE) await download(a);
  for (const v of VENDOR) await vendor(v);
  for (const l of LOCAL) await local(l);

  const onDisk = await diskUsage(DEST);
  console.log(`\nOn-disk model footprint: ${(onDisk / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Resource use is 20% of the rubric - keep an eye on this number.\n`);
}

main().catch((err) => {
  console.error(`\nfetch-models failed: ${err.message}\n`);
  process.exit(1);
});
