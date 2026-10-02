import { log } from "@skrim/shared";
import { newTaskId } from "@/lib/id.ts";
import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS, type TaskState } from "@/lib/task-state.ts";
import type { ErrorCode } from "@/lib/errors.ts";

let currentTask: TaskState | null = null;

export const taskManager = {
  start(goal: string): TaskState {
    currentTask = { taskId: newTaskId(), goal, status: "running", stepCount: 0, maxSteps: DEFAULT_MAX_STEPS, observationVersion: 0, startedAt: Date.now(), timeoutMs: DEFAULT_TIMEOUT_MS };
    log.info("task.started", { taskId: currentTask.taskId });
    return currentTask;
  },
  cancel(): void { if (currentTask) currentTask.status = "cancelled"; },
  complete(): void { if (currentTask) currentTask.status = "completed"; },
  fail(errorCode: ErrorCode): void { if (currentTask) { currentTask.status = "failed"; currentTask.lastErrorCode = errorCode; } },
  incrementStep(): boolean { if (!currentTask) return false; currentTask.stepCount += 1; return currentTask.stepCount < currentTask.maxSteps; },
  getState(): TaskState | null { return currentTask; },
  isRunning(): boolean { return currentTask?.status === "running"; },
  clear(): void { currentTask = null; },
};
