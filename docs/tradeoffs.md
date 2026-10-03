# Tradeoffs: what we measured, and what we ship

Skrim has two places where a bigger or looser model buys something and costs something: the
**planner** on the server (task success against speed and where it can run), and the **name
model** on the device (what it finds against what it hides by mistake, its size and its speed).
Each was measured, not assumed. The short version:

| Choice | What we ship | Why |
|---|---|---|
| Planner | Groq's Qwen 3.8 27B, hosted | every task, the fastest step; the server sees only placeholders, so hosted is safe |
| Planner, offline | Qwen3-VL 4B with a 16k context, local | the only one that fits a 6 GB laptop GPU; same tasks as with 4k, 3x slower a step |
| Name model | GLiNER PII edge, quint8, 46 MB | as accurate as the 181 MB model here, more precise, a third faster |
| Name cutoff | 0.6 | the most found, and the best precision short of losing names |

All numbers are on our own fixtures: expect lower on pages we did not write.

---

## 1. The planner: task success against speed

Measured with `pnpm study` ([`provider-study.md`](provider-study.md)): 14 agent tasks, 3 runs
each, through the real loop in Node; a run passes when the page ends right, nothing it was not
asked to touch was touched, and no raw personal data reached the server.

| Planner | Where it runs | Tasks passed | Step p50 / p90 | Free-tier ceiling |
|---|---|---|---|---|
| **Qwen 3.8 27B** (Groq) | hosted | **42 of 42** | **0.5 / 0.9 s** | 4–5 steps a minute, 1,000 requests a day |
| gpt-oss-120b (Groq) | hosted | 42 of 42 | 1.0 / 1.6 s | the same, on its own quota |
| Nemotron 3 Super 120B (NVIDIA) | hosted | 37 of 42 | 2.6 / 8.3 s | 40 requests a minute, no daily cap |
| Qwen3-VL 4B (Ollama) | this laptop's GPU | 37 of 42 | 0.6 / 1.1 s | none |
| Llama 3.2 11B Vision (NVIDIA) | hosted | 0 of 42 | 0.9 / 5.4 s | never says "done" |

Eight models were tried in all; the table keeps the ones that tell the story. Nemotron's and
the 4B's numbers are after the prompt rule and the code guard the study led to.

**The local model: context against speed.** Ollama's default 4k context cut real sites'
requests (3,000 to 12,000 tokens) from the front, dropping the system prompt. A 16k context
fixes that, and costs speed on a 6 GB card. 16 tasks, 3 runs each, nothing else on the GPU:

| Local planner | Tasks passed | Step p50 / p90 | Memory | Where it runs |
|---|---|---|---|---|
| Qwen3-VL 4B, 4k context | 45 of 48 | 0.6 / 0.8 s | about 3.3 GB | all on the GPU |
| Qwen3-VL 4B, 16k context (`skrim-planner`) | 45 of 48 | 1.7 / 2.4 s | 5.8 GB | 65% GPU, 35% CPU |

Every task passed or failed the same way in both. The fixtures' requests fit in 4k (the largest
was about 2,000 tokens), so the bigger context cannot win tasks here; on real sites it is what
keeps the instructions in. On real sites (Gmail), the 4B loses its way where the 27B does not.

**What it means.** The planner that does the task well does not fit on a laptop, let alone a
phone. That is the case for Skrim: keep the big model on a server, and make what reaches it
safe. Local is the proof that no server is needed, not the way most people will run it.

---

## 2. The name model: what it finds against what it hides by mistake

Measured with `pnpm eval`: the real extension in Chromium, 37 annotated fixture pages, 98
private values and 183 look-alikes that must stay readable (order numbers, ISBNs, public
names). Recall counts a value as found only when it is hidden everywhere it appears; precision
is the share of hidden spans that really were private. "Names" is the median time to find names
on a page view, in the side panel, on one WebAssembly thread.

### Size and format, at the 0.6 cutoff

GLiNER PII edge comes in three ONNX files. Each was swapped in for the shipped one:

| Model file | Size | Recall | Precision | Look-alikes hidden | Ordinary text hidden | Names, median |
|---|---|---|---|---|---|---|
| **quint8** (shipped) | **46 MB** | **99.0%** | **87.5%** | 8 of 183 | 1.9% | **238 ms** |
| fp32 | 181 MB | 99.0% | 82.5% | 8 of 183 | 2.1% | 356 ms |
| fp16 | 91 MB | 66.3% | 97.1% | 2 of 183 | 0.3% | 506 ms |

- **quint8 against fp32**: the same recall, better precision, a quarter of the size, a third
  faster. The 8-bit model loses nothing we can measure here. One caveat: the 0.6 cutoff was
  chosen on quint8, so fp32 might do a little better at a cutoff tuned for it.
- **fp16 is the wrong format for this runtime**: on ONNX Runtime's WebAssembly backend it was
  twice as slow, and its scores fell below the cutoff far more often, so it found a third fewer
  of the private values. We did not dig into why: it loses on every axis but precision.

### The cutoff, on quint8

| Cutoff | Recall | Precision | Look-alikes hidden | Ordinary text hidden | Names missed | Addresses missed |
|---|---|---|---|---|---|---|
| 0.4 | 95.9% | 73.7% | 15 of 183 | 3.4% | 1 | 3 (split into pieces) |
| 0.5 | 96.9% | 81.3% | 10 of 183 | 2.5% | 1 | 2 |
| **0.6** (shipped) | **99.0%** | **87.5%** | 8 of 183 | 1.9% | 1 | 0 |
| 0.7 | 92.9% | 92.9% | 5 of 183 | 1.2% | 5 | 2 |
| 0.8 | 75.5% | 93.8% | 3 of 183 | 0.7% | 20 | 4 |

- **Above 0.6**, precision creeps up and names start getting through: 5 at 0.7, 20 at 0.8. A
  name sent is the failure that matters, so a higher cutoff is the wrong trade.
- **Below 0.6** is worse on both sides. A lower cutoff does not find more: the model's weaker
  guesses split an address into pieces and leave parts of it readable ("partly hidden"), while
  twice as much ordinary text gets hidden. 0.6 is the peak of recall, not a compromise on it.

The name-finding time does not depend on the cutoff: across these five runs of the same model
it ranged 207 to 264 ms, which is the noise of one run against another.

---

## 3. What it costs on the device

| | |
|---|---|
| Models in the extension | 68.3 MB: names 49.4 MB, OCR 9.9 MB, faces 12.3 MB (the icon detector, 81 MB, is exported but unused, so not shipped) |
| The built extension | 87 MB, every model and runtime included; nothing downloaded at run time |
| Per page view, medians | read the page 5–10 ms, find names about 200 ms (166 to 264 ms over six runs of the shipped model), OCR 0.4–0.8 s only when a canvas, image or frame is on screen, redact under 1 ms |

On a page that shows the user's data, the on-device work adds about a quarter of a second to a
step that takes 0.5 s on Groq (more when OCR runs). On other pages it adds almost nothing:
names are only looked for on pages that show the user's data.

---

## How to measure it again

- **Planner**: `pnpm study -- <provider>:<model>`, then `pnpm study:report`
  ([`testing.md`](testing.md), "Comparing models").
- **Name model, size**: put the other file from
  `huggingface.co/knowledgator/gliner-pii-edge-v1.0/tree/main/onnx` in
  `apps/extension/public/models/gliner-pii/` under the name `model_quint8.onnx`, run `pnpm eval`,
  then `pnpm models:fetch --force` to put the shipped one back.
- **Name model, cutoff**: change `NAME_THRESHOLD` in `apps/extension/lib/pii/gliner.ts`, run
  `pnpm eval`, change it back.

Measured 2026-10-03 on the dev laptop: RTX 4050 (6 GB), i5-13420H, Chromium from Playwright.
