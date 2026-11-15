import { ActionSchema, MAX_THEN_ACTIONS } from '@skrim/schema';
import type { Action, PlanRequest, PlanResponse } from '@skrim/schema';
import { createChatCompletion, ProviderError, type ChatMessage } from '../providers/index.js';
import { buildFittedPrompt } from '../prompts/builder.js';
import type { ProviderConfig } from '../config.js';

export class UnparseableOutputError extends Error {
  constructor(readonly attempts: number) {
    super(`The model did not produce a valid action in ${attempts} attempts`);
    this.name = 'UnparseableOutputError';
  }
}

/**
 * Reasoning models (Qwen 3.x among them) can wrap their answer in
 * <think>...</think>. Braces inside that text would break the {...} extraction.
 */
function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && start <= end) {
    return text.slice(start, end + 1);
  }
  return text;
}

export type ParsedOutput =
  | { ok: true; action: Action; then: Action[] }
  | { ok: false; repairPrompt: string };

/**
 * The first action and the ones meant to follow it. Models write the list as
 * the prompt asks ("then" on the action), or as a bare list, or as
 * {"actions": [...]}; all three mean the same.
 */
function splitPlan(parsed: unknown): { first: unknown; rest: unknown[] } {
  if (Array.isArray(parsed)) return { first: parsed[0], rest: parsed.slice(1) };
  if (parsed && typeof parsed === 'object') {
    const object = parsed as Record<string, unknown>;
    if (Array.isArray(object.actions)) return { first: object.actions[0], rest: object.actions.slice(1) };
    if (Array.isArray(object.then)) {
      const { then, ...one } = object;
      return { first: one, rest: then as unknown[] };
    }
  }
  return { first: parsed, rest: [] };
}

/**
 * The follow-ups worth keeping: valid ones in order, up to the first that is
 * not, at most MAX_THEN_ACTIONS, and never "done" (the planner sees the page
 * again before a task ends). A bad follow-up is dropped, not repaired: the
 * first action alone is a fine answer.
 */
function followUps(first: Action, rest: unknown[]): Action[] {
  if (first.type === 'done') return [];
  const then: Action[] = [];
  for (const item of rest) {
    const validation = ActionSchema.safeParse(item);
    if (!validation.success || validation.data.type === 'done' || then.length >= MAX_THEN_ACTIONS) break;
    then.push(validation.data);
  }
  return then;
}

/** Turns raw model text into an action, or says what to ask the model to fix. */
export function parseModelOutput(raw: string): ParsedOutput {
  const text = stripReasoning(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      return { ok: false, repairPrompt: 'That was not valid JSON. Reply with only the JSON object for one action.' };
    }
  }

  const { first, rest } = splitPlan(parsed);
  const validation = ActionSchema.safeParse(first);
  if (validation.success) return { ok: true, action: validation.data, then: followUps(validation.data, rest) };
  return {
    ok: false,
    repairPrompt: `That JSON is not a valid action: ${validation.error.message}. Reply with only a corrected JSON object.`,
  };
}

const MAX_REPAIRS = 2;

/**
 * The prompt for this provider, shortened to its budget when the page is too
 * big. Logs what was cut, as counts.
 */
function promptFor(config: ProviderConfig, request: PlanRequest, budget: number): ChatMessage[] {
  const { messages, report, estimatedTokens } = buildFittedPrompt(request, budget);
  if (report) {
    console.log(`[plan] page too big for ${config.provider}: fitted to about ${estimatedTokens} tokens (budget ${budget}); ${report.shortened} texts shortened, ${report.leftOut} elements left out, ${report.notesDropped} old notes dropped`);
  }
  return messages;
}

/** "Request too large": Groq's answer (HTTP 413) to one request over its per-minute cap. */
function tooLarge(error: unknown): boolean {
  return error instanceof ProviderError && error.status === 413;
}

export async function planAction(config: ProviderConfig, request: PlanRequest): Promise<Omit<PlanResponse, 'latencyMs'>> {
  let messages = promptFor(config, request, config.promptBudgetTokens);
  let usage: PlanResponse['usage'];
  let refitted = false;

  for (let repairs = 0; repairs <= MAX_REPAIRS; repairs++) {
    let completion;
    try {
      completion = await createChatCompletion(config, messages);
    } catch (error) {
      // The estimate was under, or the page counts more tokens than it looks:
      // fit it again, tighter, once. A repair turn is not refitted.
      if (!tooLarge(error) || refitted || repairs > 0) throw error;
      refitted = true;
      messages = promptFor(config, request, Math.floor(config.promptBudgetTokens * 0.6));
      completion = await createChatCompletion(config, messages);
    }
    // A repair is a second request, and counts against the same limits.
    if (completion.usage) {
      usage = {
        promptTokens: (usage?.promptTokens ?? 0) + completion.usage.promptTokens,
        completionTokens: (usage?.completionTokens ?? 0) + completion.usage.completionTokens,
      };
    }
    const result = parseModelOutput(completion.text);
    if (result.ok) {
      return { action: result.action, ...(result.then.length > 0 ? { then: result.then } : {}), model: config.model, repairs, ...(usage ? { usage } : {}) };
    }
    messages.push({ role: 'assistant', content: completion.text });
    messages.push({ role: 'user', content: result.repairPrompt });
  }

  throw new UnparseableOutputError(MAX_REPAIRS + 1);
}
