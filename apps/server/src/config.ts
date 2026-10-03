export type ProviderName = 'nvidia' | 'groq' | 'ollama';

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
}

/**
 * Per provider. Groq's free tier allows 8,000 tokens a minute per model, and
 * rejects one request over that outright; 5,500 leaves room for the estimate
 * being off and for the answer. NVIDIA counts requests, not tokens; the cap is
 * there for speed. Ollama's skrim-planner reads 16k tokens and must answer too.
 */
const PROMPT_BUDGET: Record<ProviderName, number> = { groq: 5_500, nvidia: 16_000, ollama: 13_000 };

function promptBudget(provider: ProviderName): number {
  const set = Number(process.env.PROMPT_BUDGET_TOKENS);
  return Number.isFinite(set) && set > 0 ? set : PROMPT_BUDGET[provider];
}

export interface ServerConfig {
  port: number;
  providerConfig: ProviderConfig;
  /**
   * Plans a step when the main provider says to come back later: Groq's free
   * tier has a daily cap, and a day of testing reaches it. Same adapter, other
   * settings. Unset: such a step fails with the rate-limit message.
   */
  fallbackConfig?: ProviderConfig;
}

function requireKey(name: string, setting: string, provider: ProviderName): string {
  const key = process.env[name];
  if (!key) {
    throw new Error(`${name} is required when ${setting}=${provider}. Add it to the .env at the repo root.`);
  }
  return key;
}

/** `apiKey` given: use it instead of the one in the environment (a model override). */
function profile(provider: ProviderName, setting: string, apiKey?: string): ProviderConfig {
  if (provider === 'nvidia') {
    return {
      provider,
      baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      // Must match .env.example. NVIDIA hosts no Qwen. Nemotron 3 Super did 37
      // of 42 in the provider study; Llama 3.2 11B, the old default, none.
      model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
      apiKey: apiKey ?? requireKey('NVIDIA_API_KEY', setting, provider),
      promptBudgetTokens: promptBudget(provider),
    };
  }
  if (provider === 'groq') {
    return {
      provider,
      baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      // Must match .env.example. Open-weight Qwen, free without a card.
      model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
      apiKey: apiKey ?? requireKey('GROQ_API_KEY', setting, provider),
      // Qwen 3.x thinks before answering unless told not to. The planner wants
      // one JSON action, and the free tier counts thinking against its
      // 8,000 tokens a minute.
      extraBody: { reasoning_effort: process.env.GROQ_REASONING_EFFORT || 'none' },
      promptBudgetTokens: promptBudget(provider),
    };
  }
  if (provider === 'ollama') {
    return {
      provider,
      baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      // Must match .env.example. "skrim-planner" is qwen3-vl:4b-instruct with a
      // 16k context (scripts/ollama/Modelfile; make it with `pnpm ollama:setup`):
      // at Ollama's default 4k a real page's request is cut from the front. The
      // instruct build: plain "qwen3-vl:4b" is the thinking build, 10-80x slower
      // a step, and it cannot be told not to think through the OpenAI-compatible API.
      model: process.env.OLLAMA_MODEL || 'skrim-planner',
      promptBudgetTokens: promptBudget(provider),
    };
  }
  throw new Error(`Unsupported ${setting}: ${String(provider)}. Use groq, ollama or nvidia.`);
}

const KEY_SETTINGS: Record<ProviderName, string | undefined> = { groq: 'GROQ_API_KEY', nvidia: 'NVIDIA_API_KEY', ollama: undefined };

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
  // "Don't think first" is a Qwen switch; Groq rejects it for other models.
  const { extraBody, ...base } = profile(provider, 'model override', apiKey);
  return { ...base, model, ...(extraBody && /qwen/i.test(model) ? { extraBody } : {}) };
}

export function getConfig(): ServerConfig {
  const port = parseInt(process.env.PORT || '3000', 10);
  // Must match .env.example. Groq's Qwen did all 42 runs of the provider study
  // (docs/provider-study.md); NVIDIA's Llama 3.2 11B did none.
  const provider = (process.env.MODEL_PROVIDER || 'groq') as ProviderName;
  const providerConfig = profile(provider, 'MODEL_PROVIDER');

  const fallback = process.env.FALLBACK_PROVIDER?.trim();
  if (!fallback) return { port, providerConfig };
  if (fallback === provider) {
    throw new Error(`FALLBACK_PROVIDER is the same as MODEL_PROVIDER (${provider}). Name another provider, or leave it empty.`);
  }
  return { port, providerConfig, fallbackConfig: profile(fallback as ProviderName, 'FALLBACK_PROVIDER') };
}
