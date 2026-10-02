/**
 * ID generation for WS1 runtime objects.
 *
 * Task ids are random UUIDs — they identify a task session and appear in every
 * log line and message. Action ids are monotonic within a task — `a0`, `a1` —
 * so a judge reading the console can follow the sequence.
 */

export function newTaskId(): string {
  return crypto.randomUUID();
}

export function newActionId(stepCount: number): string {
  return `a${stepCount}`;
}

