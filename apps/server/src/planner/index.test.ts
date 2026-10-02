import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseModelOutput } from './index.js';

describe('parseModelOutput', () => {
  test('accepts a bare JSON action', () => {
    const result = parseModelOutput('{"type":"click","target":"e4"}');
    assert.deepEqual(result, { ok: true, action: { type: 'click', target: 'e4' } });
  });

  test('digs the action out of prose and markdown fences', () => {
    const result = parseModelOutput('Sure:\n```json\n{"type":"wait","ms":500}\n```');
    assert.deepEqual(result, { ok: true, action: { type: 'wait', ms: 500 } });
  });

  test('ignores reasoning wrapped in think tags, braces and all', () => {
    const result = parseModelOutput('<think>maybe {"type":"scroll"}? no.</think>\n{"type":"done","success":true,"summary":"ok"}');
    assert.deepEqual(result, { ok: true, action: { type: 'done', success: true, summary: 'ok' } });
  });

  test('asks for a repair when the JSON is not an action', () => {
    const result = parseModelOutput('{"type":"click"}');
    assert.equal(result.ok, false);
  });

  test('asks for a repair when there is no JSON at all', () => {
    const result = parseModelOutput('I would click the button.');
    assert.equal(result.ok, false);
  });
});
