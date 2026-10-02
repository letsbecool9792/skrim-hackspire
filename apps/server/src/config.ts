export interface ProviderConfig {
  provider: 'nvidia' | 'ollama';
  baseURL: string;
  model: string;
  apiKey?: string;
}

export function getConfig(): { port: number, providerConfig: ProviderConfig } {
  const port = parseInt(process.env.PORT || '3000', 10);
  const provider = (process.env.MODEL_PROVIDER || 'nvidia') as 'nvidia' | 'ollama';

  let baseURL: string;
  let model: string;
  let apiKey: string | undefined;

  if (provider === 'nvidia') {
    baseURL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
    // Must match .env.example. The only vision model that answered on a free
    // NVIDIA account when checked; Qwen is not hosted there.
    model = process.env.NVIDIA_MODEL || 'meta/llama-3.2-11b-vision-instruct';
    apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      throw new Error('NVIDIA_API_KEY is required when using the nvidia provider.');
    }
  } else if (provider === 'ollama') {
    baseURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
    model = process.env.OLLAMA_MODEL || 'qwen3-vl:4b';
  } else {
    throw new Error(`Unsupported MODEL_PROVIDER: ${provider}`);
  }

  return {
    port,
    providerConfig: {
      provider,
      baseURL,
      model,
      apiKey
    }
  };
}
