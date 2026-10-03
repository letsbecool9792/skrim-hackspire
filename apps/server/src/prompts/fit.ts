import type { PlanRequest, ScreenElement } from '@skrim/schema';

/**
 * Keeps a request inside the provider's budget, so a big page is shortened
 * instead of refused. Groq's free tier caps a model at 8,000 tokens a minute,
 * and a single request over that is rejected outright ("Request too large",
 * HTTP 413): on Gmail the inbox fitted, the open thread did not, and the task
 * stopped after one step. A real page renders to 3,000 to 12,000 tokens; the
 * fixtures to about 1,700.
 *
 * A request that fits is sent exactly as it was: nothing here runs on the
 * fixtures, so the provider study's numbers stand. When it does not fit, what
 * the planner needs least goes first, and what it acts on goes last:
 *
 *   1. very long text is cut to 160 characters
 *   2. text outside the view is left out (counted in "Not listed", so the
 *      planner knows to scroll)
 *   3. old steps' notes are dropped (the actions stay; the last three keep theirs)
 *   4. text in the view is cut to 100, then 60 characters
 *   5. controls outside the view are left out, farthest first
 *   6. text in the view is cut to 30 characters
 *
 * Text on screen outlasts old notes because it is what a "read" or
 * "summarise" goal needs; controls just outside the view outlast it because
 * a "reply" goal needs the Reply button below the message.
 *
 * Buttons, links, fields and the other controls in the view are never left
 * out: they are what the planner acts on. A cut never splits a placeholder
 * (<PII:EMAIL:1>): it is kept whole or left out whole. Nothing is added, so
 * privacy is untouched: trimming only removes.
 */

/** Elements the planner acts on. Kept until everything else is gone. */
const CONTROL_ROLES = new Set<ScreenElement['role']>([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox',
  'option', 'slider', 'tab', 'menuitem', 'dialog', 'heading',
]);

const TOKEN = /<PII:[A-Z_]+:\d+>/g;

/**
 * Tokens from characters. Measured: the system prompt (prose) is about 3.7
 * characters a token for Qwen; element lines, dense with ids, quotes and
 * numbers, are counted at 2.8 so a long page is overestimated, not under.
 */
export function estimateTokens(systemChars: number, userChars: number): number {
  return Math.ceil(systemChars / 3.7 + userChars / 2.8) + 20;
}

export interface FitReport {
  /** Texts that were cut short. */
  shortened: number;
  /** Elements left out (and counted as beyond the view). */
  leftOut: number;
  /** History steps whose notes were dropped. */
  notesDropped: number;
}

/** Cuts text to about `max` characters at a word, never through a placeholder. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  // Keep a placeholder that starts before the cut whole.
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start < end && start + match[0].length > end) end = start + match[0].length;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > max * 0.6 && !insideToken(text, space)) end = space;
  }
  return `${text.slice(0, end).trimEnd()}…`;
}

function insideToken(text: string, index: number): boolean {
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (index > start && index < start + match[0].length) return true;
  }
  return false;
}

function isControl(element: ScreenElement): boolean {
  return CONTROL_ROLES.has(element.role) || (element.state?.includes('editable') ?? false);
}

/** In the view: overlaps the viewport vertically. */
function inView(element: ScreenElement, viewportHeight: number): boolean {
  const [, y, , h] = element.bbox;
  return y + h > 0 && y < viewportHeight;
}

/** How far outside the view, in pixels; 0 inside it. */
function distanceFromView(element: ScreenElement, viewportHeight: number): number {
  const [, y, , h] = element.bbox;
  if (y + h <= 0) return -(y + h);
  if (y >= viewportHeight) return y - viewportHeight;
  return 0;
}

/** Cuts an element's label and value; `shortened` collects the ids of those cut. */
function capElement(element: ScreenElement, max: number, shortened: Set<string>): ScreenElement {
  let changed = false;
  const next = { ...element };
  if (next.label && next.label.length > max) { next.label = cutText(next.label, max); changed = true; }
  if (typeof next.value === 'string' && next.value.length > max) { next.value = cutText(next.value, max); changed = true; }
  if (changed) shortened.add(element.id);
  return changed ? next : element;
}

/**
 * The request, shortened until `measure` says it is within `budget` tokens.
 * Returns it unchanged (the same object) when it already fits.
 */
export function fitRequest(
  request: PlanRequest,
  budget: number,
  measure: (request: PlanRequest) => number,
): { request: PlanRequest; report: FitReport | null } {
  if (measure(request) <= budget) return { request, report: null };

  const report: FitReport = { shortened: 0, leftOut: 0, notesDropped: 0 };
  const shortened = new Set<string>();
  const height = request.graph.viewport.height;
  let elements = [...request.graph.elements];
  let history = request.history;
  let above = request.graph.beyondView?.above ?? 0;
  let below = request.graph.beyondView?.below ?? 0;

  const current = (): PlanRequest => ({
    ...request,
    history,
    graph: { ...request.graph, elements, beyondView: { above, below } },
  });
  const fits = () => measure(current()) <= budget;

  const leaveOut = (keep: (element: ScreenElement) => boolean, farthestFirst: boolean) => {
    const candidates = elements
      .filter((element) => !keep(element))
      .sort((a, b) => farthestFirst ? distanceFromView(b, height) - distanceFromView(a, height) : 0);
    for (const element of candidates) {
      if (fits()) return;
      elements = elements.filter((other) => other !== element);
      if (element.bbox[1] < 0) above += 1; else below += 1;
      report.leftOut += 1;
    }
  };

  const steps: Array<() => void> = [
    // 1. Very long text, anywhere.
    () => { elements = elements.map((element) => capElement(element, 160, shortened)); },
    // 2. Text outside the view.
    () => leaveOut((element) => isControl(element) || inView(element, height), true),
    // 3. Notes of all but the last three steps; the actions themselves stay.
    () => {
      const keepFrom = history.length - 3;
      history = history.map((step, index) => {
        if (index >= keepFrom || !step.note) return step;
        report.notesDropped += 1;
        const { note: _note, ...rest } = step;
        return rest;
      });
    },
    // 4. Text in the view, shorter, then shorter again.
    () => { elements = elements.map((element) => (isControl(element) ? element : capElement(element, 100, shortened))); },
    () => { elements = elements.map((element) => (isControl(element) ? element : capElement(element, 60, shortened))); },
    // 5. Controls outside the view, farthest first.
    () => leaveOut((element) => inView(element, height), true),
    // 6. Last resort: text in the view, very short.
    () => { elements = elements.map((element) => (isControl(element) ? element : capElement(element, 30, shortened))); },
  ];

  for (const step of steps) {
    if (fits()) break;
    step();
  }
  // Only the elements still sent count as shortened.
  const kept = new Set(elements.map((element) => element.id));
  report.shortened = [...shortened].filter((id) => kept.has(id)).length;
  return { request: current(), report };
}
