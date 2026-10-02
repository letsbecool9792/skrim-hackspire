import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { getConfig } from './config.js';

const SETTINGS = ['MODEL_PROVIDER', 'FALLBACK_PROVIDER', 'GROQ_API_KEY', 'NVIDIA_API_KEY', 'NVIDIA_MODEL'];
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

  test("NVIDIA's default is the model that finished tasks, not Llama 3.2 11B", () => {
    set({ MODEL_PROVIDER: 'nvidia', NVIDIA_API_KEY: 'test-key' });
    assert.equal(getConfig().providerConfig.model, 'nvidia/nemotron-3-super-120b-a12b');
  });

  test('names the setting that needs a key', () => {
    set({ GROQ_API_KEY: 'test-key', FALLBACK_PROVIDER: 'nvidia' });
    assert.throws(() => getConfig(), /NVIDIA_API_KEY is required when FALLBACK_PROVIDER=nvidia/);
  });

  test('refuses a fallback that is the main provider', () => {
    set({ GROQ_API_KEY: 'test-key', FALLBACK_PROVIDER: 'groq' });
    assert.throws(() => getConfig(), /same as MODEL_PROVIDER/);
  });
});
