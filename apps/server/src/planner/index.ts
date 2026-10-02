import { ActionSchema } from '@skrim/schema';
import type { Action, PlanRequest, PlanResponse } from '@skrim/schema';
import { createChatCompletion } from '../providers/index.js';
import { buildPrompt } from '../prompts/builder.js';
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
  | { ok: true; action: Action }
  | { ok: false; repairPrompt: string };

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

  const validation = ActionSchema.safeParse(parsed);
  if (validation.success) return { ok: true, action: validation.data };
  return {
    ok: false,
    repairPrompt: `That JSON is not a valid action: ${validation.error.message}. Reply with only a corrected JSON object.`,
  };
}

const MAX_REPAIRS = 2;

export async function planAction(config: ProviderConfig, request: PlanRequest): Promise<Omit<PlanResponse, 'latencyMs'>> {
  const messages = buildPrompt(request);
  let usage: PlanResponse['usage'];

  for (let repairs = 0; repairs <= MAX_REPAIRS; repairs++) {
    const completion = await createChatCompletion(config, messages);
    // A repair is a second request, and counts against the same limits.
    if (completion.usage) {
      usage = {
        promptTokens: (usage?.promptTokens ?? 0) + completion.usage.promptTokens,
        completionTokens: (usage?.completionTokens ?? 0) + completion.usage.completionTokens,
      };
    }
    const result = parseModelOutput(completion.text);
    if (result.ok) {
      return { action: result.action, model: config.model, repairs, ...(usage ? { usage } : {}) };
    }
    messages.push({ role: 'assistant', content: completion.text });
    messages.push({ role: 'user', content: result.repairPrompt });
  }

  throw new UnparseableOutputError(MAX_REPAIRS + 1);
}
