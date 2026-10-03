import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PlanRequest, ScreenElement } from '@skrim/schema';

import { buildFittedPrompt, buildPrompt } from './builder.js';
import { cutText } from './fit.js';

const VIEW = { width: 1280, height: 720 };

function el(id: number, role: ScreenElement['role'], label: string, y: number, extra: Partial<ScreenElement> = {}): ScreenElement {
  return { id: `e${id}`, role, label, bbox: [10, y, 600, 24], source: 'dom', ...extra };
}

function request(elements: ScreenElement[], history: PlanRequest['history'] = []): PlanRequest {
  return {
    goal: 'reply to my last email with "hello"',
    graph: {
      cycle: 3,
      url: { origin: 'https://mail.example', pathTemplate: '/mail/u/{n}/', hasQuery: false },
      title: 'Inbox',
      viewport: VIEW,
      elements,
      manifest: { regions: [], tokensInPlay: ['<PII:NAME:1>', '<PII:EMAIL:1>'] },
    },
    history,
  };
}

const LONG = 'The quarterly figures are attached; please review the variance in section four before Thursday, and tell <PII:NAME:1> if the travel budget needs another pass before the board sees it on Friday morning.';

/** A webmail thread: a long open message in view, a reply box below it, an inbox list around it. */
function bigThread(): PlanRequest {
  const elements: ScreenElement[] = [];
  let id = 1;
  elements.push(el(id++, 'button', 'Compose', 20), el(id++, 'searchbox', 'Search mail', 20, { state: ['editable'] }));
  elements.push(el(id++, 'heading', 'Q3 numbers', 90));
  for (let i = 0; i < 30; i += 1) elements.push(el(id++, 'text', LONG, 120 + i * 20));
  elements.push(el(id++, 'button', 'Reply', 900), el(id++, 'button', 'Forward', 900));
  for (let i = 0; i < 60; i += 1) elements.push(el(id++, 'link', `<PII:NAME:${(i % 9) + 1}> — ${LONG}`, -400 - i * 30));
  return request(elements, Array.from({ length: 6 }, (_, i) => ({
    cycle: i,
    action: { type: 'click', target: `e${i + 1}` },
    verified: true,
    note: 'appeared: a long list of messages, a toolbar, a search box and the folders on the left',
  })));
}

describe('fitting a request to the budget', () => {
  test('a request that fits is sent exactly as before', () => {
    const small = request([el(1, 'button', 'Send', 100), el(2, 'textbox', 'Message', 60, { state: ['editable'] })]);
    const fitted = buildFittedPrompt(small, 5_500);
    assert.equal(fitted.report, null);
    assert.deepEqual(fitted.messages, buildPrompt(small));
  });

  test('a page too big is shortened under the budget, keeping the controls it acts on', () => {
    const big = bigThread();
    const before = buildFittedPrompt(big, 1_000_000).estimatedTokens;
    const fitted = buildFittedPrompt(big, 5_500);
    assert.ok(before > 5_500, `the test page should start over budget (${before})`);
    assert.ok(fitted.estimatedTokens <= 5_500, `fitted to ${fitted.estimatedTokens}`);
    assert.ok(fitted.report);
    const prompt = fitted.messages[1]?.content ?? '';
    // Every control in the view stays, and the reply box below it, the one this goal needs.
    for (const label of ['"Compose"', '"Search mail"', '"Q3 numbers"', '"Reply"', '"Forward"']) assert.match(prompt, new RegExp(label));
    // The planner is told, and what was left out is counted.
    assert.match(prompt, /too long to send whole/);
    assert.match(prompt, /Not listed: \d+ more elements above the view/);
  });

  test('text in the view is cut before any control is left out', () => {
    const fitted = buildFittedPrompt(bigThread(), 5_500);
    const prompt = fitted.messages[1]?.content ?? '';
    const inViewText = prompt.split('\n').filter((line) => / text "/.test(line));
    assert.ok(inViewText.length > 0, 'text in the view is still listed');
    assert.ok(inViewText.every((line) => line.length < LONG.length), 'and shortened');
  });

  test('a cut never splits a placeholder', () => {
    const cut = cutText('Forwarded by <PII:NAME:12> to the whole team yesterday', 18);
    assert.equal(cut, 'Forwarded by <PII:NAME:12>…');
    assert.equal(cutText('short', 10), 'short');
  });

  test('old steps lose their notes before controls are dropped, and the actions stay', () => {
    const fitted = buildFittedPrompt(bigThread(), 5_500);
    const prompt = fitted.messages[1]?.content ?? '';
    assert.equal((prompt.match(/"type":"click"/g) ?? []).length, 6);
  });
});
