import { ActionSchema } from '@skrim/schema';
import type { PlanRequest, PlanResponse } from '@skrim/schema';
import { createChatCompletion } from '../providers/index.js';
import type { ChatMessage } from '../providers/index.js';
import { buildPrompt } from '../prompts/builder.js';
import type { ProviderConfig } from '../config.js';

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && start <= end) {
    return text.slice(start, end + 1);
  }
  return text;
}

export async function planAction(config: ProviderConfig, request: PlanRequest): Promise<Omit<PlanResponse, 'latencyMs'>> {
  let messages = buildPrompt(request);
  let repairs = 0;
  const maxRepairs = 2;

  while (repairs <= maxRepairs) {
    const responseText = await createChatCompletion(config, messages);
    
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      try {
        parsed = JSON.parse(extractJson(responseText));
      } catch (e2) {
        if (repairs < maxRepairs) {
          repairs++;
          messages.push({ role: 'assistant', content: responseText });
          messages.push({ role: 'user', content: 'Invalid JSON. Please output only a valid JSON object.' });
          continue;
        } else {
          throw new Error('unparseable_model_output');
        }
      }
    }

    const validation = ActionSchema.safeParse(parsed);
    if (validation.success) {
      return {
        action: validation.data,
        model: config.model,
        repairs,
      };
    } else {
      if (repairs < maxRepairs) {
        repairs++;
        messages.push({ role: 'assistant', content: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) });
        messages.push({ role: 'user', content: `JSON validation failed: ${validation.error.message}. Please fix the errors and return a valid JSON object matching the ActionSchema.` });
        continue;
      } else {
        throw new Error('unparseable_model_output');
      }
    }
  }

  throw new Error('unparseable_model_output');
}
