import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rateLimitWaitMs } from './index.js';

describe('rateLimitWaitMs', () => {
  test('reads the Retry-After header first', () => {
    assert.equal(rateLimitWaitMs('3', 'Please try again in 9s'), 3000);
  });

  test("reads Groq's own wording, minutes included", () => {
    const groq = 'Rate limit reached for model `qwen/qwen3.8-27b` ... Please try again in 2.957142857s. Need more tokens?';
    assert.equal(rateLimitWaitMs(null, groq), 2958);
    assert.equal(rateLimitWaitMs(null, 'Please try again in 1m2.5s.'), 62_500);
  });

  test('says nothing when the provider does not', () => {
    assert.equal(rateLimitWaitMs(null, 'Too many requests'), undefined);
  });
});
