import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { getConfig, overrideConfig } from './config.js';
import { COMPACT_SYSTEM_PROMPT, SYSTEM_PROMPT } from './prompts/system.js';

const SETTINGS = ['PROMPT_STYLE', 'MODEL_PROVIDER', 'FALLBACK_PROVIDER', 'GROQ_API_KEY', 'NVIDIA_API_KEY', 'NVIDIA_MODEL', 'CEREBRAS_API_KEY'];
const saved = Object.fromEntries(SETTINGS.map((name) => [name, process.env[name]]));

function set(values: Record<string, string | undefined>): void {
  for (const name of SETTINGS) delete process.env[name];
  for (const [name, value] of Object.entries(values)) if (value !== undefined) process.env[name] = value;
}

afterEach(() => set(saved));

describe('getConfig', () => {
  test('defaults to Groq, with no fallback', () => {
    set({ GROQ_API_KEY: 'test-key' });
    const config = getConfig();
    assert.equal(config.providerConfig.provider, 'groq');
    assert.equal(config.providerConfig.model, 'qwen/qwen3.8-27b');
    assert.equal(config.fallbackConfig, undefined);
  });

  test('takes a fallback for when the main provider says to come back later', () => {
    set({ GROQ_API_KEY: 'test-key', FALLBACK_PROVIDER: 'ollama' });
    assert.equal(getConfig().fallbackConfig?.model, 'skrim-planner');
  });

  test("NVIDIA's default is a model a free account can call, and it thinks unless told not to", () => {
    set({ MODEL_PROVIDER: 'nvidia', NVIDIA_API_KEY: 'test-key' });
    const config = getConfig().providerConfig;
    assert.equal(config.model, 'nvidia/nemotron-3.5-lightning-30b-a3b');
    assert.equal(config.extraBody, undefined);
    process.env.NVIDIA_THINKING = 'off';
    try {
      assert.deepEqual(getConfig().providerConfig.extraBody, { chat_template_kwargs: { enable_thinking: false } });
    } finally {
      delete process.env.NVIDIA_THINKING;
    }
  });

  test('names the setting that needs a key', () => {
    set({ GROQ_API_KEY: 'test-key', FALLBACK_PROVIDER: 'nvidia' });
    assert.throws(() => getConfig(), /NVIDIA_API_KEY is required when FALLBACK_PROVIDER=nvidia/);
  });

  test('refuses a fallback that is the main provider', () => {
    set({ GROQ_API_KEY: 'test-key', FALLBACK_PROVIDER: 'groq' });
    assert.throws(() => getConfig(), /names MODEL_PROVIDER/);
  });

  test('takes a list of fallbacks, in order; each but the last hands a long pause to the next', () => {
    set({ GROQ_API_KEY: 'k', CEREBRAS_API_KEY: 'k', FALLBACK_PROVIDER: 'cerebras, ollama' });
    const config = getConfig();
    assert.deepEqual(config.fallbackConfigs.map((c) => c.provider), ['cerebras', 'ollama']);
    assert.equal(config.fallbackConfig?.provider, 'cerebras');
    assert.equal(config.fallbackConfigs[0]?.model, 'qwen-3.8-27b');
    assert.equal(config.providerConfig.maxRateLimitWaitMs, 5_000);
    assert.equal(config.fallbackConfigs[0]?.maxRateLimitWaitMs, 5_000);
    // The last waits as long as the adapter allows: there is nowhere else to go.
    assert.equal(config.fallbackConfigs[1]?.maxRateLimitWaitMs, undefined);
  });

  test('Cerebras needs its own key', () => {
    set({ GROQ_API_KEY: 'k', FALLBACK_PROVIDER: 'cerebras' });
    assert.throws(() => getConfig(), /CEREBRAS_API_KEY is required/);
  });
});

describe('overrideConfig: a model picked in the side panel', () => {
  test('keeps a model id that holds a colon, and needs no key for Ollama', () => {
    set({});
    const config = overrideConfig('ollama:qwen3-vl:4b-instruct', undefined);
    assert.equal(config?.provider, 'ollama');
    assert.equal(config?.model, 'qwen3-vl:4b-instruct');
  });

  test("uses the user's key, else this server's, and plans as before without either", () => {
    set({});
    assert.equal(overrideConfig('groq:llama-3.3-70b-versatile', 'user-key')?.apiKey, 'user-key');
    assert.equal(overrideConfig('groq:llama-3.3-70b-versatile', undefined), undefined);
    set({ GROQ_API_KEY: 'server-key' });
    const config = overrideConfig('groq:llama-3.3-70b-versatile', undefined);
    assert.equal(config?.apiKey, 'server-key');
    // "Do not think first" is for Qwen; Groq rejects it for other models.
    assert.equal(config?.extraBody, undefined);
    assert.equal(overrideConfig('nope:model', 'k'), undefined);
  });
});

describe('the system prompt per provider', () => {
  test('hosted models get the compact prompt, the local one the full prompt, and PROMPT_STYLE overrides both', () => {
    set({ GROQ_API_KEY: 'k', FALLBACK_PROVIDER: 'ollama' });
    const config = getConfig();
    assert.equal(config.providerConfig.promptStyle, 'compact');
    assert.equal(config.fallbackConfigs[0]?.promptStyle, 'full');
    set({ GROQ_API_KEY: 'k', PROMPT_STYLE: 'full' });
    assert.equal(getConfig().providerConfig.promptStyle, 'full');
  });

  test('the compact prompt is a third the size and still teaches every action and "then"', () => {
    assert.ok(COMPACT_SYSTEM_PROMPT.length < SYSTEM_PROMPT.length * 0.45, `${COMPACT_SYSTEM_PROMPT.length} vs ${SYSTEM_PROMPT.length}`);
    for (const type of ['click', 'type', 'select', 'scroll', 'navigate', 'extract', 'wait', 'done']) assert.match(COMPACT_SYSTEM_PROMPT, new RegExp(`"type": "${type}"`));
    assert.match(COMPACT_SYSTEM_PROMPT, /"then"/);
    assert.match(COMPACT_SYSTEM_PROMPT, /<PII:EMAIL:1>/);
  });
});
