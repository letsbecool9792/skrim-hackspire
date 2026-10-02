# Skrim

**A browser agent that does the task without your personal data ever leaving your machine.**

AI browser agents work by sending your screen to a company's server, so your inbox, your bank
balance and your face end up on someone else's GPU. Skrim keeps all of that on your device. The
model that does the thinking only ever sees a scrubbed description of the page, with every
private value swapped for a placeholder like `<PII:EMAIL:1>`. The extension swaps the real value
back in only at the moment it types it.

Built by team **tropical crush**.

## How it works

For every step of a task, in a side panel in Chrome:

1. **Observe.** The extension reads the page: its structure, text, fields, and the text inside
   canvases, images and frames (local OCR).
2. **Redact.** Everything private is replaced by a placeholder, on the device, against a token
   vault that lives in memory only. A rule decides which names are private. Regexes find
   emails, phones, cards, Aadhaar, PAN and more; a small local model (GLiNER) finds names and
   addresses in free text.
3. **Plan.** The scrubbed page goes to a server that asks an open-weight model (Qwen) for one
   action: click, type, select, scroll, navigate, extract, wait, done. A tripwire refuses to
   send any request that still holds raw personal data.
4. **Act.** The extension carries the action out, putting real values back only when typing, and
   checks that the page changed. Orders, payments, deletes and sign-ups the user did not ask for
   are refused.
5. **Repeat** until done.

The server is stateless and open-weight only, so it can run on a laptop with no network: swap
the hosted Qwen for a local one with one setting. A dashboard shows, live, exactly what the
server received, beside what the models cost on the device.

## What it measures like

The eval opens fixture pages in a real Chromium with the extension and scores what Skrim hid
against what was actually private (`pnpm eval`, 37 fixtures):

| | |
|---|---|
| Recall (private values hidden) | 92.9% (91 of 98) |
| Precision (hidden values that were private) | 86.8% |
| Ordinary text hidden by mistake | 1.9% |

These are our own pages, written by the same hands as the fixes, so expect lower on pages we
did not write. The misses and what they are: [`CLAUDE.md`](CLAUDE.md), "What the eval finds".
The planner: Groq's Qwen 3.8 27B finished all 42 runs of the provider study, and the local
Qwen3-VL 4B finished 37 of 42: [`docs/provider-study.md`](docs/provider-study.md).

## Run it

Needs Node 22, pnpm (`npm install -g pnpm`), and a free Groq key.

```powershell
git clone https://github.com/letsbecool9792/skrim-hackspire.git
cd skrim-hackspire
pnpm install
pnpm models:fetch                 # the on-device models; the first run also sets up Python for the icon detector (~10 min)
cp .env.example .env              # then put your GROQ_API_KEY in it
pnpm dev:server                   # the planning server
pnpm --filter @skrim/extension build
```

Then in Chrome: `chrome://extensions`, turn on Developer mode, **Load unpacked**, and choose
`apps/extension/.output/chrome-mv3`. Open any page, click Skrim's toolbar button, and ask it
to do something. For the live dashboard, run `pnpm dev:dashboard` and open the address it prints.

Step by step, with what to expect from each part: [`docs/testing.md`](docs/testing.md).

## The repo

| | |
|---|---|
| `apps/extension` | The product: side panel, agent loop, on-device models, WXT for Chrome and Firefox |
| `apps/server` | Planner: one OpenAI-compatible adapter (Groq, Ollama, NVIDIA) |
| `apps/dashboard` | The live view of what the server sees |
| `packages/schema` | The contract shared by all of them |
| `packages/eval` | The harness behind the numbers above |
| `design/tokens.css` | The shared look |
| `fixtures` | Synthetic pages with a list of what is private on each |

Where the project stands, what was decided and why: [`CLAUDE.md`](CLAUDE.md). The problem,
the scoring and the privacy design: [`BRIEF.md`](BRIEF.md).

## Licences

The code is ISC. Each model keeps its own licence: check them before shipping anything. Qwen
is Apache 2.0; the OmniParser icon detector is **AGPL-3.0**.
