import { z } from "zod";
import type { ErrorCode } from "./errors.ts";

/**
 * Task lifecycle statuses.
 *
 * Transitions:
 *   idle → running → waiting → running → ... → completed | failed | cancelled
 *
 * `waiting` means the background is waiting for a planner response or an action
 * result. `running` means it is actively orchestrating.
 */
export const TASK_STATUSES = [
  "idle",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * In-memory task state. Held by the background service worker for the duration
 * of one task. Wiped on completion, cancellation, or timeout.
 *
 * INVARIANT: this is NEVER persisted. No chrome.storage, no localStorage, no
 * IndexedDB. The privacy claim is "nothing persists" and a judge will check.
 */
export interface TaskState {
  taskId: string;
  goal: string;
  status: TaskStatus;
  stepCount: number;
  maxSteps: number;
  observationVersion: number;
  startedAt: number;
  timeoutMs: number;
  lastErrorCode?: ErrorCode;
}

export const DEFAULT_MAX_STEPS = 25;
export const DEFAULT_TIMEOUT_MS = 120_000;

