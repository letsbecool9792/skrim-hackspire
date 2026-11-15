import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseModelOutput } from './index.js';

describe('parseModelOutput', () => {
  test('accepts a bare JSON action', () => {
    const result = parseModelOutput('{"type":"click","target":"e4"}');
    assert.deepEqual(result, { ok: true, action: { type: 'click', target: 'e4' }, then: [] });
  });

  test('digs the action out of prose and markdown fences', () => {
    const result = parseModelOutput('Sure:\n```json\n{"type":"wait","ms":500}\n```');
    assert.deepEqual(result, { ok: true, action: { type: 'wait', ms: 500 }, then: [] });
  });

  test('ignores reasoning wrapped in think tags, braces and all', () => {
    const result = parseModelOutput('<think>maybe {"type":"scroll"}? no.</think>\n{"type":"done","success":true,"summary":"ok"}');
    assert.deepEqual(result, { ok: true, action: { type: 'done', success: true, summary: 'ok' }, then: [] });
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

describe('parseModelOutput: several actions', () => {
  const name = { type: 'type', target: 'e2', value: '<PII:NAME:1>' };
  const email = { type: 'type', target: 'e3', value: '<PII:EMAIL:1>' };
  const send = { type: 'click', target: 'e9' };

  test('reads follow-ups written as "then" on the first action, as the prompt asks', () => {
    const result = parseModelOutput(JSON.stringify({ ...name, then: [email, send] }));
    assert.deepEqual(result, { ok: true, action: name, then: [email, send] });
  });

  test('reads a bare list, and {"actions": [...]}, the same way', () => {
    assert.deepEqual(parseModelOutput(JSON.stringify([name, email])), { ok: true, action: name, then: [email] });
    assert.deepEqual(parseModelOutput(JSON.stringify({ actions: [name, send] })), { ok: true, action: name, then: [send] });
  });

  test('stops the follow-ups at a done or an invalid one, and keeps the first action', () => {
    const done = { type: 'done', success: true, summary: 'ok' };
    assert.deepEqual(parseModelOutput(JSON.stringify({ ...name, then: [email, done, send] })), { ok: true, action: name, then: [email] });
    assert.deepEqual(parseModelOutput(JSON.stringify({ ...name, then: [{ type: 'fly' }, send] })), { ok: true, action: name, then: [] });
  });
});
