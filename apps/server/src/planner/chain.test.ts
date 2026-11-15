import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PlanRequest } from '@skrim/schema';
import type { ProviderConfig } from '../config.js';
import { ProviderError } from '../providers/index.js';
import { planWithChain } from './chain.js';

const provider = (name: ProviderConfig['provider'], handOver = true): ProviderConfig => ({
  provider: name, baseURL: 'http://x', model: `${name}-model`, promptBudgetTokens: 5_000, promptStyle: 'compact', ...(handOver ? { maxRateLimitWaitMs: 5_000 } : {}),
});
const request = {} as PlanRequest;
const plan = (model: string) => ({ action: { type: 'wait' as const, ms: 1 }, model, repairs: 0 });
const limited = (ms?: number) => new ProviderError('rate_limited', 'come back later', undefined, 429, ms);
const gone = () => new ProviderError('http', 'HTTP 404', undefined, 404);

describe('planning with a list of providers', () => {
  test('the main provider plans when it can', async () => {
    const asked: string[] = [];
    const result = await planWithChain([provider('groq'), provider('cerebras', false)], request, async (p) => { asked.push(p.provider); return plan(p.model); }, new Map());
    assert.equal(result.model, 'groq-model');
    assert.deepEqual(asked, ['groq']);
  });

  test('a rate-limited provider hands the step on, and is skipped until its pause is over', async () => {
    const resting = new Map<string, number>();
    const asked: string[] = [];
    const planOne = async (p: ProviderConfig) => { asked.push(p.provider); if (p.provider === 'groq') throw limited(30_000); return plan(p.model); };
    const chain = [provider('groq'), provider('cerebras', false)];
    assert.equal((await planWithChain(chain, request, planOne, resting)).model, 'cerebras-model');
    assert.equal((await planWithChain(chain, request, planOne, resting)).model, 'cerebras-model');
    // The second step did not ask Groq again.
    assert.deepEqual(asked, ['groq', 'cerebras', 'cerebras']);
  });

  test("another model on the same provider is not rested with it: Groq limits each model apart", async () => {
    const qwen = { ...provider('groq'), model: 'qwen' };
    const oss = { ...provider('groq', false), model: 'oss' };
    const resting = new Map<string, number>();
    const asked: string[] = [];
    const planOne = async (p: ProviderConfig) => { asked.push(p.model); if (p.model === 'qwen') throw limited(30_000); return plan(p.model); };
    assert.equal((await planWithChain([qwen, oss], request, planOne, resting)).model, 'oss');
    assert.equal((await planWithChain([qwen, oss], request, planOne, resting)).model, 'oss');
    assert.deepEqual(asked, ['qwen', 'oss', 'oss']);
  });

  test("when all fail, the rate limit is the error reported, not a broken provider's", async () => {
    await assert.rejects(planWithChain([provider('ollama'), provider('groq', false)], request, async (p) => {
      throw p.provider === 'ollama' ? gone() : limited(120_000);
    }, new Map()), (error: unknown) => error instanceof ProviderError && error.kind === 'rate_limited');
  });

  test('a fallback that fails for its own reasons is passed over', async () => {
    const result = await planWithChain([provider('groq'), provider('nvidia'), provider('cerebras', false)], request, async (p) => {
      if (p.provider === 'groq') throw limited(30_000);
      if (p.provider === 'nvidia') throw gone();
      return plan(p.model);
    }, new Map());
    assert.equal(result.model, 'cerebras-model');
  });

  test('when every other provider fails, a short pause is sat out after all', async () => {
    const waits: Array<number | undefined> = [];
    const result = await planWithChain([provider('groq'), provider('nvidia', false)], request, async (p) => {
      waits.push(p.maxRateLimitWaitMs);
      if (p.provider === 'nvidia') throw gone();
      // Groq refuses while it would hand over, and answers once it may wait.
      if (p.maxRateLimitWaitMs !== undefined) throw limited(12_000);
      return plan(p.model);
    }, new Map());
    assert.equal(result.model, 'groq-model');
    assert.deepEqual(waits, [5_000, undefined, undefined]);
  });

  test('when the providers still awake fail, the rested one due back soon plans, waiting if it must', async () => {
    const resting = new Map([['groq:groq-model', Date.now() + 10_000]]);
    const asked: Array<[string, number | undefined]> = [];
    const result = await planWithChain([provider('groq'), provider('nvidia', false)], request, async (p) => {
      asked.push([p.provider, p.maxRateLimitWaitMs]);
      if (p.provider === 'nvidia') throw gone();
      return plan(p.model);
    }, resting);
    assert.equal(result.model, 'groq-model');
    // NVIDIA first (Groq was resting), then Groq, allowed to wait out its pause.
    assert.deepEqual(asked, [['nvidia', undefined], ['groq', undefined]]);
  });

  test("the model's own failure is not passed on, and a long pause with nowhere to go fails the step", async () => {
    await assert.rejects(planWithChain([provider('groq'), provider('cerebras', false)], request, async () => { throw new Error('no valid action'); }, new Map()), /no valid action/);
    await assert.rejects(planWithChain([provider('groq'), provider('nvidia', false)], request, async (p) => { throw p.provider === 'groq' ? limited(600_000) : gone(); }, new Map()), /come back later/);
  });
});
