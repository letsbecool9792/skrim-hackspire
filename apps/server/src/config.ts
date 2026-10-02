export type ProviderName = 'nvidia' | 'groq' | 'ollama';

export interface ProviderConfig {
  provider: ProviderName;
  baseURL: string;
  model: string;
  apiKey?: string;
  /** Extra fields for the chat-completions body, for a provider-specific switch. */
  extraBody?: Record<string, unknown>;
}

function requireKey(name: string, provider: ProviderName): string {
  const key = process.env[name];
  if (!key) {
    throw new Error(`${name} is required when MODEL_PROVIDER=${provider}. Add it to the .env at the repo root.`);
  }
  return key;
}

export function getConfig(): { port: number, providerConfig: ProviderConfig } {
  const port = parseInt(process.env.PORT || '3000', 10);
  const provider = (process.env.MODEL_PROVIDER || 'nvidia') as ProviderName;

  let providerConfig: ProviderConfig;

  if (provider === 'nvidia') {
    providerConfig = {
      provider,
      baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      // Must match .env.example. The only vision model that answered on a free
      // NVIDIA account when checked; Qwen is not hosted there.
      model: process.env.NVIDIA_MODEL || 'meta/llama-3.2-11b-vision-instruct',
      apiKey: requireKey('NVIDIA_API_KEY', provider),
    };
  } else if (provider === 'groq') {
    providerConfig = {
      provider,
      baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      // Must match .env.example. Open-weight Qwen, free without a card.
      model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
      apiKey: requireKey('GROQ_API_KEY', provider),
      // Qwen 3.x thinks before answering unless told not to. The planner wants
      // one JSON action, and the free tier counts thinking against its
      // 8,000 tokens a minute.
      extraBody: { reasoning_effort: process.env.GROQ_REASONING_EFFORT || 'none' },
    };
  } else if (provider === 'ollama') {
    providerConfig = {
      provider,
      baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      // Must match .env.example. The instruct build: plain "qwen3-vl:4b" is the
      // thinking build, 10-80x slower a step, and it cannot be told not to think
      // through the OpenAI-compatible API.
      model: process.env.OLLAMA_MODEL || 'qwen3-vl:4b-instruct',
    };
  } else {
    throw new Error(`Unsupported MODEL_PROVIDER: ${provider}. Use nvidia, groq or ollama.`);
  }

  return { port, providerConfig };
}
