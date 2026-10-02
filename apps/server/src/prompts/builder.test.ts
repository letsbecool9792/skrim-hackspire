import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PlanRequest } from '@skrim/schema';
import { renderElement, renderRequest } from './builder.js';

const request: PlanRequest = {
  goal: 'Enter my email',
  graph: {
    cycle: 1,
    url: { origin: 'https://shop.example', pathTemplate: '/account/{id}', hasQuery: true },
    title: 'Sign in',
    viewport: { width: 1280, height: 720 },
    elements: [
      { id: 'e1', role: 'button', label: 'Toggle panel', value: 'Show Panel', bbox: [16, 100, 120, 32], state: ['collapsed'], source: 'dom' },
      { id: 'e2', role: 'textbox', label: 'Email', value: '<PII:EMAIL:1>', bbox: [16, 80, 300, 36], source: 'dom' },
    ],
    manifest: { regions: [], tokensInPlay: ['<PII:EMAIL:1>'] },
    screenshot: 'data:image/png;base64,AAAA',
  },
  history: [
    { cycle: 0, action: { type: 'click', target: 'e1', reason: 'open it' }, verified: false, note: 'nothing changed' },
  ],
  extracted: { my_email: '<PII:EMAIL:1>' },
};

describe('renderElement', () => {
  test('shows visible text after the name when they differ', () => {
    assert.equal(
      renderElement(request.graph.elements[0]!),
      'e1 button "Toggle panel" = "Show Panel" [16,100,120,32] (collapsed)',
    );
  });

  test('omits a value that repeats the name', () => {
    assert.equal(
      renderElement({ id: 'e3', role: 'link', label: 'Home', value: 'Home', bbox: [0, 0, 10, 10], source: 'dom' }),
      'e3 link "Home" [0,0,10,10]',
    );
  });

  test('marks elements that came from vision', () => {
    assert.equal(
      renderElement({ id: 'e4', role: 'button', bbox: [0, 0, 10, 10], source: 'vision', confidence: 0.8 }),
      'e4 button [0,0,10,10] {vision 0.80}',
    );
  });
});

describe('renderRequest', () => {
  const text = renderRequest(request);

  test('includes the goal, page, tokens and known values', () => {
    assert.match(text, /^Goal: Enter my email$/m);
    assert.match(text, /^Page: "Sign in" at https:\/\/shop\.example\/account\/\{id\}\?\.\.\.$/m);
    assert.match(text, /^Tokens on this page: <PII:EMAIL:1>$/m);
    assert.match(text, /^my_email = "<PII:EMAIL:1>"$/m);
  });

  test('shows history outcomes without the reason', () => {
    assert.match(text, /^1\. \{"type":"click","target":"e1"\} -> NOT verified: nothing changed$/m);
    assert.doesNotMatch(text, /open it/);
  });

  test('never sends the screenshot as text', () => {
    assert.doesNotMatch(text, /base64/);
  });
});
