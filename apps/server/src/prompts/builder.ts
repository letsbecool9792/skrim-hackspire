import type { PlanRequest } from '@skrim/schema';
import type { ChatMessage } from '../providers/index.js';
import { SYSTEM_PROMPT } from './system.js';

export function buildPrompt(request: PlanRequest): ChatMessage[] {
  const userContent = JSON.stringify({
    goal: request.goal,
    graph: request.graph,
    history: request.history,
    extracted: request.extracted
  }, null, 2);

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ];
}
