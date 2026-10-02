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

**One provider adapter.** NVIDIA, Ollama, Cloudflare and OpenRouter all speak
OpenAI-compatible chat completions. Swap `baseURL` and `model` from env. **Never write a
second code path** — demo beat 8 is switching to a local offline model live on stage, and
that only works if it is one env var.

**Never log a request body.** Log the action type, latency, repair count, model id. Nothing
else. Even though the payload should be free of PII, "should be" is not a logging policy.

## Handling model output

Small open-weight models produce malformed JSON regularly. Expect it:

1. Parse. If it fails, extract the outermost `{...}` and retry the parse.
2. Validate with `ActionSchema.safeParse`.
3. On failure, re-prompt once with the validation error appended.
4. Give up after two repairs and return `unparseable_model_output`.

Report `repairs` in the response. A repair count that is consistently nonzero means the
prompt needs work, not that the model is bad — and the dashboard shows it.

## Config

One `.env` at the **repo root**, loaded via `--env-file-if-exists=../../.env`. See
[`/.env.example`](../../.env.example). Only `nvidia` and `ollama` are wired.

```powershell
pnpm dev:server       # from the repo root
```

Every teammate needs their **own** NVIDIA key — the ~40 RPM free tier is per account.
