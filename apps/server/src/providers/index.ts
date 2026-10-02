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
    /** For a rate limit: how long the provider said to wait, when it said. */
    readonly retryAfterMs?: number,
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

export interface Completion {
  text: string;
  /** Tokens the provider counted, when it says. */
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Free tiers limit tokens a minute: Groq's 8,000 is 4-5 planning steps. The
 * provider study (docs/provider-study.md) hit that limit 125 times in 42 tasks
 * with Groq's Qwen, and each time Groq said to wait 2-3 s. So a rate limit is
 * waited out when the provider says how long and it is short; a long one still
 * fails the step, with a message saying why.
 */
const MAX_RATE_LIMIT_WAIT_MS = 20_000;
const MAX_RATE_LIMIT_WAITING_MS = 30_000;

/** How long a 429 asks to wait: the Retry-After header, or Groq's "try again in 1m2.5s". */
export function rateLimitWaitMs(retryAfter: string | null, body: string): number | undefined {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && retryAfter.trim() !== '' && Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
  const said = /try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/i.exec(body);
  if (!said) return undefined;
  return Math.ceil((Number(said[1] ?? 0) * 60 + Number(said[2])) * 1000);
}

export async function createChatCompletion(config: ProviderConfig, messages: ChatMessage[]): Promise<Completion> {
  let waited = 0;
  for (;;) {
    try {
      return await requestWithOneRetry(config, messages);
    } catch (error) {
      if (!(error instanceof ProviderError) || error.kind !== 'rate_limited' || error.retryAfterMs === undefined) throw error;
      const wait = error.retryAfterMs + 250;
      if (error.retryAfterMs > MAX_RATE_LIMIT_WAIT_MS || waited + wait > MAX_RATE_LIMIT_WAITING_MS) throw error;
      console.warn(`[plan] ${config.provider} rate limit; waiting ${(wait / 1000).toFixed(1)} s as it asked`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      waited += wait;
    }
  }
}

async function requestWithOneRetry(config: ProviderConfig, messages: ChatMessage[]): Promise<Completion> {
  try {
    return await requestCompletion(config, messages);
  } catch (error) {
    if (config.provider === 'ollama' || !(error instanceof ProviderError) || !isRetryable(error)) throw error;
    console.warn(`[plan] ${error.message}; retrying once`);
    return requestCompletion(config, messages);
  }
}

async function requestCompletion(config: ProviderConfig, messages: ChatMessage[]): Promise<Completion> {
  // Ollama's OpenAI-compat endpoint (/v1/chat/completions) silently ignores
  // the think:false flag on thinking-build models (qwen3-vl:4b). Its native
  // endpoint (/api/chat) does forward it. Route Ollama through that path so
  // think:false actually suppresses the chain-of-thought and steps go from
  // 22-84 s down to ~1-2 s on a 6 GB GPU.
  if (config.provider === 'ollama') {
    return requestOllamaChat(config, messages);
  }

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
        temperature: 0.2,
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
    const body = await response.text();
    const detail = body.slice(0, 500);
    if (response.status === 429) {
      const retryAfterMs = rateLimitWaitMs(response.headers.get('retry-after'), body);
      throw new ProviderError('rate_limited', `The ${config.provider} rate limit was reached. Wait a minute and retry.`, detail, 429, retryAfterMs);
    }
    throw new ProviderError('http', `The ${config.provider} provider returned HTTP ${response.status} for ${config.model}`, detail, response.status);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderError('bad_response', `The ${config.provider} provider returned no message`);
  }
  const prompt = data.usage?.prompt_tokens;
  const completion = data.usage?.completion_tokens;
  return {
    text: content,
    ...(Number.isInteger(prompt) && Number.isInteger(completion) ? { usage: { promptTokens: prompt, completionTokens: completion } } : {}),
  };
}

/**
 * Ollama native API path. Strips the /v1 suffix from OLLAMA_BASE_URL (which
 * points at the OpenAI-compat shim) to reach the real Ollama port, then calls
 * /api/chat — the only endpoint that forwards think:false to the model.
 */
async function requestOllamaChat(config: ProviderConfig, messages: ChatMessage[]): Promise<Completion> {
  // OLLAMA_BASE_URL is e.g. http://localhost:11434/v1 — drop the /v1 suffix.
  const ollamaBase = config.baseURL.replace(/\/v1\/?$/, '');
  const timeoutMs = TIMEOUT_MS.ollama;

  // Map OpenAI roles to Ollama roles (same names, but explicit for clarity).
  const ollamaMessages = messages.map((m) => ({ role: m.role, content: m.content }));

  let response: Response;
  try {
    response = await fetch(`${ollamaBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: ollamaMessages,
        stream: false,
        options: { temperature: 0.2 },
        // think:false is the key flag — it suppresses Qwen3's chain-of-thought
        // on thinking-build models. On instruct builds it is a harmless no-op.
        think: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ProviderError('timeout', `No reply from ${config.model} within ${timeoutMs / 1000} s`);
    }
    throw new ProviderError('network', 'Could not reach the Ollama provider', String(err));
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new ProviderError('http', `The ollama provider returned HTTP ${response.status} for ${config.model}`, detail, response.status);
  }

  const data = await response.json();
  const content = data.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderError('bad_response', 'The ollama provider returned no message');
  }
  return { text: content };
}
