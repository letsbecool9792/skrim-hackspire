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
    /** The provider's HTTP status, when it answered at all. */
    readonly status?: number,
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
  nvidia: 40_000,
  groq: 40_000,
  ollama: 120_000,
};

/**
 * Hosted free tiers sometimes sit on one request and answer the next at once:
 * NVIDIA's Llama 3.2 11B usually replied in about 1 s but left
 * 2 of about 50 requests unanswered for a minute. So a timeout or a 5xx from a
 * hosted provider is retried once. Ollama is local; retrying it only doubles
 * the wait.
 */
function isRetryable(error: ProviderError): boolean {
  return error.kind === 'timeout' || (error.kind === 'http' && error.status !== undefined && error.status >= 500);
}

export async function createChatCompletion(config: ProviderConfig, messages: ChatMessage[]): Promise<string> {
  try {
    return await requestCompletion(config, messages);
  } catch (error) {
    if (config.provider === 'ollama' || !(error instanceof ProviderError) || !isRetryable(error)) throw error;
    console.warn(`[plan] ${error.message}; retrying once`);
    return requestCompletion(config, messages);
  }
}

async function requestCompletion(config: ProviderConfig, messages: ChatMessage[]): Promise<string> {
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
        ...config.extraBody,
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
      throw new ProviderError('rate_limited', `The ${config.provider} rate limit was reached. Wait a minute and retry.`, detail, 429);
    }
    throw new ProviderError('http', `The ${config.provider} provider returned HTTP ${response.status} for ${config.model}`, detail, response.status);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderError('bad_response', `The ${config.provider} provider returned no message`);
  }
  // An empty string is a model problem, not a provider one: a thinking model
  // can spend its whole reply on reasoning. The planner re-asks, like any
  // unparseable output.
  return content;
}
