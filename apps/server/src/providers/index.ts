import type { ProviderConfig } from '../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
      throw new Error(`Provider error (timeout): no reply from ${config.model} within ${timeoutMs / 1000} s`);
    }
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Provider error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Invalid response format from provider');
  }

  return content;
}
