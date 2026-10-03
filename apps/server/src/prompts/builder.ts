import type { Action, PlanRequest, ScreenElement } from '@skrim/schema';
import type { ChatMessage } from '../providers/index.js';
import { SYSTEM_PROMPT } from './system.js';

/**
 * The request is rendered as compact text rather than pretty-printed JSON: one
 * line per element instead of about ten. That cuts the prompt several times
 * over, which is latency on every provider and the difference between one and
 * several requests a minute on Groq's 8,000 tokens-a-minute free tier.
 *
 * The screenshot, when present, is not sent: every wired model is prompted as
 * text-only for now. Element `children` are left out; the list is in document
 * order, which carries most of the same structure.
 *
 * Positions cost about 10 tokens an element, but Qwen3-VL 4B needs them: with
 * none it typed into a form's labels instead of its fields (1 of 4 runs
 * passed), and with only the top-left corner it clicked a search box instead
 * of typing into it (0 of 3). Measure before trimming this format again.
 */
export function buildPrompt(request: PlanRequest): ChatMessage[] {
  const systemContent = request.customInstructions 
    ? `${SYSTEM_PROMPT}\n\nUSER-SPECIFIC INSTRUCTIONS:\n${request.customInstructions}`
    : SYSTEM_PROMPT;
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: renderRequest(request) }
  ];
}

export function renderRequest(request: PlanRequest): string {
  const { graph } = request;
  const lines: string[] = [];

  lines.push(`Goal: ${request.goal}`, '');

  const query = graph.url.hasQuery ? '?...' : '';
  lines.push(`Page: ${JSON.stringify(graph.title)} at ${graph.url.origin}${graph.url.pathTemplate}${query}`);
  lines.push(`Viewport: ${graph.viewport.width}x${graph.viewport.height}`);
  lines.push('Elements:');
  if (graph.elements.length === 0) lines.push('(none found)');
  for (const element of graph.elements) lines.push(renderElement(element));
  const beyond = graph.beyondView;
  if (beyond && beyond.above + beyond.below > 0) {
    lines.push(`Not listed: ${beyond.above} more elements above the view and ${beyond.below} below. Scroll to reach them.`);
  }

  if (graph.manifest.regions.length > 0) {
    const regions = graph.manifest.regions.map((r) => `${r.category} at [${r.bbox.join(',')}]`);
    lines.push(`Blacked-out image regions: ${regions.join('; ')}`);
  }
  if (graph.manifest.tokensInPlay.length > 0) {
    lines.push(`Tokens on this page: ${graph.manifest.tokensInPlay.join(' ')}`);
  }

  const extracted = Object.entries(request.extracted ?? {});
  if (extracted.length > 0) {
    lines.push('', 'Known values:');
    for (const [key, value] of extracted) lines.push(`${key} = ${JSON.stringify(value)}`);
  }

  lines.push('', 'History, oldest first (element ids refer to the page as it was then):');
  if (request.history.length === 0) lines.push('(nothing yet, this is the first step)');
  request.history.forEach((step, index) => {
    const outcome = `${step.verified ? 'verified' : 'NOT verified'}${step.note ? `: ${step.note}` : ''}`;
    lines.push(`${index + 1}. ${renderAction(step.action)} -> ${outcome}`);
  });

  lines.push('', 'Reply with the next action as one JSON object.');
  return lines.join('\n');
}

export function renderElement(element: ScreenElement): string {
  let line = `${element.id} ${element.role}`;
  if (element.label) line += ` ${JSON.stringify(element.label)}`;
  if (element.value !== undefined && element.value !== '' && element.value !== element.label) {
    line += ` = ${JSON.stringify(element.value)}`;
  }
  if (element.hint) line += ` hint ${JSON.stringify(element.hint)}`;
  line += ` [${element.bbox.join(',')}]`;
  if (element.state && element.state.length > 0) line += ` (${element.state.join(', ')})`;
  // Read from pixels: there is no element in the page to click. A "fused"
  // element is a DOM element vision agreed with, and acts like one.
  if (element.source === 'vision') line += ' {vision}';
  return line;
}

/** The action as the model would write it, minus its reason. */
function renderAction(action: Action): string {
  const { reason: _reason, ...rest } = action;
  return JSON.stringify(rest);
}
