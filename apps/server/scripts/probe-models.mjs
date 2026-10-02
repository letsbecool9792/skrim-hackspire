/**
 * Which chat models each free provider serves right now, whether they answer,
 * how fast, and the rate limits they report. Input to the provider study
 * (`pnpm study`, docs/testing.md).
 *
 *   pnpm --filter @skrim/server probe                 # every provider with a key in .env
 *   pnpm --filter @skrim/server probe groq            # one provider
 *   pnpm --filter @skrim/server probe groq qwen llama # only models whose id contains one of these
 *
 * Sends each model one tiny request. Prints ids, timings and limit numbers;
 * never a key or a reply's content.
 */

const PROVIDERS = {
  groq: { base: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1", key: process.env.GROQ_API_KEY },
  nvidia: { base: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1", key: process.env.NVIDIA_API_KEY },
};

/** Not chat models, or not ones that can plan: speech, embeddings, guards, image generators. */
const NOT_CHAT = /whisper|tts|embed|guard|rerank|safety|vision-embed|clip|parakeet|canary|flux|stable-diffusion|sdxl|reward|nemoretriever|nv-embed|colbert|deplot|kosmos|neva|vila|paligemma|detector|ocr|cosmos|fuyu|seamless|riva|bge|arctic-embed|llama-guard|shieldgemma|prompt-guard|content-safety|topic-control|jailbreak|compound|playai|orpheus|allam/i;

const [only, ...filters] = process.argv.slice(2);
const TIMEOUT_MS = 30_000;

async function probe(name, provider, model) {
  const started = Date.now();
  try {
    const response = await fetch(`${provider.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: 'Reply with exactly {"ok":true}' }], max_tokens: 16, temperature: 0 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    const header = (key) => response.headers.get(key) ?? "-";
    const limits = `req/day ${header("x-ratelimit-limit-requests")}, tokens/min ${header("x-ratelimit-limit-tokens")}`;
    await response.text();
    return `${response.ok ? "ok  " : String(response.status).padEnd(4)} ${String(ms).padStart(6)} ms  ${model}${name === "groq" ? `  (${limits})` : ""}`;
  } catch (error) {
    return `${error?.name === "TimeoutError" ? "slow" : "fail"} ${String(Date.now() - started).padStart(6)} ms  ${model}`;
  }
}

for (const [name, provider] of Object.entries(PROVIDERS)) {
  if (only && only !== name) continue;
  if (!provider.key) {
    console.log(`\n${name}: no key in .env, skipped`);
    continue;
  }
  const listing = await fetch(`${provider.base}/models`, { headers: { Authorization: `Bearer ${provider.key}` } });
  if (!listing.ok) {
    console.log(`\n${name}: listing models failed, HTTP ${listing.status}`);
    continue;
  }
  const ids = (await listing.json()).data.map((model) => model.id).filter((id) => !NOT_CHAT.test(id)).sort();
  const chosen = filters.length > 0 ? ids.filter((id) => filters.some((filter) => id.includes(filter))) : ids;
  console.log(`\n${name}: ${ids.length} chat models listed, probing ${chosen.length} (ok = answered; slow = no reply in ${TIMEOUT_MS / 1000} s)\n`);
  // A few at a time: NVIDIA's free tier allows about 40 requests a minute.
  for (let index = 0; index < chosen.length; index += 4) {
    const lines = await Promise.all(chosen.slice(index, index + 4).map((model) => probe(name, provider, model)));
    for (const line of lines) console.log(line);
  }
}
