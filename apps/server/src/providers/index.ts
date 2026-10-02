import type { ProviderConfig } from '../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * A failed provider call. `message` is safe to return to the client. `detail`
 * is for the server log only: provider error bodies can carry account and
 * function ids (NVIDIA's 404s do), and the client has no use for them.
 */
export class ProviderError extends Error {
  constructor(
    readonly kind: 'timeout' | 'rate_limited' | 'http' | 'network' | 'bad_response',
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Longest we wait for one model reply. Without a limit, a stalled provider
 * stalls the server and leaves the extension's task "running" forever.
 * Ollama gets longer: its first request loads the model into VRAM, which took
 * over 60 s for qwen3-vl:4b on a 6 GB laptop GPU.
 */
const TIMEOUT_MS: Record<ProviderConfig['provider'], number> = {
  nvidia: 60_000,
  ollama: 120_000,
};

export async function createChatCompletion(config: ProviderConfig, messages: ChatMessage[]): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const timeoutMs = TIMEOUT_MS[config.provider];
  let response: Response;
  try {
    response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2, // low temp for planning
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ProviderError('timeout', `No reply from ${config.model} within ${timeoutMs / 1000} s`);
    }
    throw new ProviderError('network', `Could not reach the ${config.provider} provider`, String(err));
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    if (response.status === 429) {
      throw new ProviderError('rate_limited', `The ${config.provider} rate limit was reached. Wait a minute and retry.`, detail);
    }
    throw new ProviderError('http', `The ${config.provider} provider returned HTTP ${response.status} for ${config.model}`, detail);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new ProviderError('bad_response', `The ${config.provider} provider returned no message`);
  }

  return content;
}
