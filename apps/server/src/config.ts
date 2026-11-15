import type { PromptStyle } from './prompts/builder.js';

export type ProviderName = 'nvidia' | 'groq' | 'ollama' | 'cerebras';

const PROVIDERS: readonly ProviderName[] = ['groq', 'cerebras', 'nvidia', 'ollama'];

export interface ProviderConfig {
  provider: ProviderName;
  baseURL: string;
  model: string;
  apiKey?: string;
  /** Extra fields for the chat-completions body, for a provider-specific switch. */
  extraBody?: Record<string, unknown>;
  /**
   * The most tokens a request may estimate at; a bigger page is shortened to
   * fit (prompts/fit.ts). PROMPT_BUDGET_TOKENS overrides it for every provider.
   */
  promptBudgetTokens: number;
  /**
   * The longest rate-limit pause to sit out before giving the step to the
   * next provider. Unset: the adapter's own limit (providers/index.ts), for
   * a provider with nothing after it.
   */
  maxRateLimitWaitMs?: number;
  /**
   * The system prompt: "compact" for big hosted models (a third of the
   * tokens, sent with every step), "full" for the small local one, which
   * needs its worked examples. PROMPT_STYLE overrides it for every provider.
   */
  promptStyle: PromptStyle;
}

/**
 * Per provider. Groq's free tier allows 8,000 tokens a minute per model, and
 * rejects one request over that outright; 5,500 leaves room for the estimate
 * being off and for the answer. NVIDIA counts requests, not tokens; the cap is
 * there for speed. Ollama's skrim-planner reads 12k tokens and must answer too.
 */
const PROMPT_BUDGET: Record<ProviderName, number> = { groq: 5_500, cerebras: 12_000, nvidia: 16_000, ollama: 10_000 };

/**
 * Groq's gpt-oss-120b on the compact prompt clicked a toggle open and shut
 * until the loop stopped it, and answered "what is my PAN" without the PAN;
 * on the full one it did neither (2026-11-15).
 */
function promptStyle(provider: ProviderName, model: string): PromptStyle {
  const set = process.env.PROMPT_STYLE;
  if (set === 'full' || set === 'compact') return set;
  return provider === 'ollama' || /gpt-oss/i.test(model) ? 'full' : 'compact';
}

function promptBudget(provider: ProviderName): number {
  const set = Number(process.env.PROMPT_BUDGET_TOKENS);
  return Number.isFinite(set) && set > 0 ? set : PROMPT_BUDGET[provider];
}

export interface ServerConfig {
  port: number;
  providerConfig: ProviderConfig;
  /**
   * Plan a step, in order, when the one before says to come back later: free
   * tiers cap tokens a minute and a day, and each provider's caps are its
   * own. FALLBACK_PROVIDER is a comma list ("groq:openai/gpt-oss-120b,nvidia"). Same adapter,
   * other settings. Empty: such a step fails with the rate-limit message.
   */
  fallbackConfigs: ProviderConfig[];
  /** The first of fallbackConfigs, for what the server reports about itself. */
  fallbackConfig?: ProviderConfig;
}

/**
 * With another provider to go to, a pause longer than this goes there instead
 * of being sat out: Groq's per-minute refill can be 40 s, and Cerebras or
 * NVIDIA answer now. Groq's usual 2-3 s pauses are still waited out.
 */
const HAND_OVER_AFTER_MS = 5_000;

function requireKey(name: string, setting: string, provider: ProviderName): string {
  const key = process.env[name];
  if (!key) {
    throw new Error(`${name} is required when ${setting}=${provider}. Add it to the .env at the repo root.`);
  }
  return key;
}

/**
 * Groq's switch for thinking before answering, which its free tier counts
 * against 8,000 tokens a minute. Qwen turns it off with "none"; gpt-oss cannot,
 * and "low" is its least (what it did 42 of 42 with in the provider study).
 * Other models reject the field.
 */
function groqReasoning(model: string): string | undefined {
  if (process.env.GROQ_REASONING_EFFORT) return process.env.GROQ_REASONING_EFFORT;
  if (/qwen/i.test(model)) return 'none';
  if (/gpt-oss/i.test(model)) return 'low';
  return undefined;
}

/**
 * `apiKey` given: use it instead of the one in the environment (a model
 * override). `model` given: that model instead of the profile's default.
 */
function profile(provider: ProviderName, setting: string, apiKey?: string, model?: string): ProviderConfig {
  const config = providerProfile(provider, setting, apiKey, model);
  return { ...config, promptStyle: promptStyle(provider, config.model) };
}

function providerProfile(provider: ProviderName, setting: string, apiKey?: string, model?: string): Omit<ProviderConfig, 'promptStyle'> {
  if (provider === 'nvidia') {
    return {
      provider,
      baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      // Must match .env.example. NVIDIA hosts no Qwen. Nemotron 3 Super did 37
      // of 42 in the provider study; Llama 3.2 11B, the old default, none.
      // Nemotron 3 Super answered 404 for a free account by 2026-11-15, though
      // still listed. Of those that answered, Lightning did 6 of 8 agent tasks
      // (median 10.7 s a step) and Ultra 6 of 8 (it clicked a counter 25 times).
      model: model || process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b',
      apiKey: apiKey ?? requireKey('NVIDIA_API_KEY', setting, provider),
      // Nemotron thinks before it answers. NVIDIA_THINKING=off sends the switch
      // that stops it (chat_template_kwargs; a "/no_think" line does nothing):
      // a step drops from ~300 tokens to ~11, but Lightning then went in
      // circles on every page (0 of 5 before hitting NVIDIA's 40 a minute).
      ...(process.env.NVIDIA_THINKING === 'off' ? { extraBody: { chat_template_kwargs: { enable_thinking: false } } } : {}),
      promptBudgetTokens: promptBudget(provider),
    };
  }
  if (provider === 'groq') {
    // Must match .env.example. Open-weight Qwen, free without a card.
    const groqModel = model || process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
    const reasoning = groqReasoning(groqModel);
    return {
      provider,
      baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      model: groqModel,
      apiKey: apiKey ?? requireKey('GROQ_API_KEY', setting, provider),
      ...(reasoning ? { extraBody: { reasoning_effort: reasoning } } : {}),
      promptBudgetTokens: promptBudget(provider),
    };
  }
  if (provider === 'cerebras') {
    return {
      provider,
      baseURL: process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
      // Must match .env.example. The same Qwen 3.8 27B as Groq's, with its own
      // allowance. It needs a card (a payment method before any request), so it is not used.
      model: model || process.env.CEREBRAS_MODEL || 'qwen-3.8-27b',
      apiKey: apiKey ?? requireKey('CEREBRAS_API_KEY', setting, provider),
      ...(process.env.CEREBRAS_REASONING_EFFORT ? { extraBody: { reasoning_effort: process.env.CEREBRAS_REASONING_EFFORT } } : {}),
      promptBudgetTokens: promptBudget(provider),
    };
  }
  if (provider === 'ollama') {
    return {
      provider,
      baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      // Must match .env.example. "skrim-planner" is Qwen3 4B Instruct (2507), text
      // only, with a 12k context (scripts/ollama/Modelfile; `pnpm ollama:setup`):
      // at Ollama's default 4k a real page's request is cut from the front. An
      // instruct build: a thinking build is 10-80x slower a step, and cannot be
      // told not to think through the OpenAI-compatible API.
      model: model || process.env.OLLAMA_MODEL || 'skrim-planner',
      promptBudgetTokens: promptBudget(provider),
    };
  }
  throw new Error(`Unsupported ${setting}: ${String(provider)}. Use ${PROVIDERS.join(', ')}.`);
}

const KEY_SETTINGS: Record<ProviderName, string | undefined> = { groq: 'GROQ_API_KEY', cerebras: 'CEREBRAS_API_KEY', nvidia: 'NVIDIA_API_KEY', ollama: undefined };

/**
 * A model picked in the side panel for one request: "provider:model" (the
 * model id may hold colons: "ollama:qwen3-vl:4b-instruct"). The user's own
 * key comes in a header, never in the request body; without one, this
 * server's key for that provider. Undefined when the provider is not one of
 * ours, or a hosted one has no key at all: the default planner then plans.
 */
export function overrideConfig(modelOverride: string, userKey: string | undefined): ProviderConfig | undefined {
  const at = modelOverride.indexOf(':');
  const provider = modelOverride.slice(0, at) as ProviderName;
  const model = modelOverride.slice(at + 1).trim();
  if (at <= 0 || !model || !(provider in PROMPT_BUDGET)) return undefined;
  const setting = KEY_SETTINGS[provider];
  const apiKey = userKey || (setting ? process.env[setting] : undefined);
  if (setting && !apiKey) return undefined;
  const config = profile(provider, 'model override', apiKey, model);
  // Groq's profile picks its switch per model. NVIDIA's thinking switch is a
  // Nemotron one, and Cerebras's a Qwen one: drop them for other models.
  if (provider === 'groq' || !config.extraBody || /qwen|nemotron/i.test(model)) return config;
  const { extraBody: _dropped, ...rest } = config;
  return rest;
}

/** One provider and model: what a rate limit applies to, on Groq at least. */
export function providerKey(config: Pick<ProviderConfig, 'provider' | 'model'>): string {
  return `${config.provider}:${config.model}`;
}

export function getConfig(): ServerConfig {
  const port = parseInt(process.env.PORT || '3000', 10);
  // Must match .env.example. Groq's Qwen did all 42 runs of the provider study
  // (docs/provider-study.md); NVIDIA's Llama 3.2 11B did none.
  const provider = (process.env.MODEL_PROVIDER || 'groq') as ProviderName;
  const providerConfig = profile(provider, 'MODEL_PROVIDER');

  // Each entry is a provider ("nvidia") or a provider and model
  // ("groq:openai/gpt-oss-120b"): Groq's limits are per model, so another
  // model there is another day's allowance on the same key.
  const entries = (process.env.FALLBACK_PROVIDER ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const fallbackConfigs = entries.map((entry) => {
    const at = entry.indexOf(':');
    const name = (at < 0 ? entry : entry.slice(0, at)).trim() as ProviderName;
    const model = at < 0 ? undefined : entry.slice(at + 1).trim() || undefined;
    return profile(name, 'FALLBACK_PROVIDER', undefined, model);
  });
  const seen = new Set([providerKey(providerConfig)]);
  for (const config of fallbackConfigs) {
    if (seen.has(providerKey(config))) {
      throw new Error(`FALLBACK_PROVIDER names ${config.provider} ${config.model} twice, or as MODEL_PROVIDER. Each must be another provider or model.`);
    }
    seen.add(providerKey(config));
  }
  // Each provider with another after it hands over a long pause instead of sitting it out.
  const chain = [providerConfig, ...fallbackConfigs];
  for (const config of chain.slice(0, -1)) config.maxRateLimitWaitMs = HAND_OVER_AFTER_MS;
  return { port, providerConfig, fallbackConfigs, ...(fallbackConfigs[0] ? { fallbackConfig: fallbackConfigs[0] } : {}) };
}
