# apps/server — the planning brain

**Workstream 4.** Hono on Node 22. Deliberately thin.

## What it does

Receives a `PlanRequest` (redacted screen graph + goal + history), builds a prompt, calls an
open-weight VLM, validates the response against `ActionSchema`, returns one `PlanResponse`.

That is the whole job. **No ML runs here.** No image processing, no detection, no redaction —
redaction cannot happen server-side by definition, because the data would already have
arrived (brief §6).

## The rules

**Open-weight models only. Anything else breaks the privacy claim.** Brief §4.4 requires a model that could
run air-gapped. Never GPT, Gemini, or Claude as the planning brain. `pnpm check` fails the
build if a vendor SDK appears in the imports.

**Stateless. No identity, no session, no memory, no database.** Everything the model needs
arrives in the request. There is nothing on this server to correlate because nothing persists
here — that is the privacy claim, not an implementation detail. Do not add a cache keyed by
user, or a "recent tasks" list, or logging of request bodies.

**One provider adapter.** NVIDIA, Groq, Ollama, Cloudflare and OpenRouter all speak
OpenAI-compatible chat completions. Swap `baseURL` and `model` from env. **Never write a
second code path** — demo beat 8 is switching to a local offline model live on stage, and
that only works if it is one env var. A profile may add fields to the request body
(`extraBody`, e.g. Groq's `reasoning_effort`); that is configuration, not a code path.

**Never log a request body.** Log counts, the action type and target id, latency, repair
count. Nothing else. Even though the payload should be free of PII, "should be" is not a
logging policy. Provider error bodies go to the log only, never to the client: they can
carry account ids.

## The prompt

`src/prompts/builder.ts` renders the request as text, one line per element
(`e4 button "Increment counter" = "Count: 0" [16,250,120,32] (collapsed)`), several times
smaller than JSON. The screenshot is not sent. The history comes with each step's
`verified` flag and note ("now it is expanded"), and the system prompt tells the model to
answer `done` once the history shows the goal reached. Some models ignore that; measure
with `pnpm test:agent` before choosing one.

## Handling model output

Small open-weight models produce malformed JSON regularly. Expect it:

1. Strip `<think>...</think>`. Parse. If it fails, extract the outermost `{...}` and retry.
2. Validate with `ActionSchema.safeParse`.
3. On failure (an empty reply included), re-prompt with the error appended.
4. Give up after two repairs and return `unparseable_model_output`.

Report `repairs` in the response. A repair count that is consistently nonzero means the
prompt needs work, not that the model is bad — and the dashboard shows it.

Hosted calls time out after 40 s and are retried once on a timeout or 5xx; Ollama gets
120 s and no retry.

## Config

One `.env` at the **repo root**, loaded via `--env-file-if-exists=../../.env`. See
[`/.env.example`](../../.env.example). `groq` (the default), `ollama` and `nvidia` are wired;
pick one with `MODEL_PROVIDER`.

```powershell
pnpm dev:server       # from the repo root; its log is this terminal
pnpm smoke:server     # four canned requests
pnpm test:agent       # the fixture pages through the whole extension loop
```

Every teammate needs their **own** keys — free-tier limits are per account.
