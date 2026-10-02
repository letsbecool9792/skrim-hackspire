import { type TaskState, type TaskStatus, DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS } from '@/lib/task-state.ts';
import { type ErrorCode } from '@/lib/errors.ts';
import { newTaskId } from '@/lib/id.ts';
import { log } from '@skrim/shared';
import type { TaskState, TaskStatus } from "@/lib/task-state.ts";
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
} from "@/lib/task-state.ts";
import type { ErrorCode } from "@/lib/errors.ts";
import { newTaskId } from "@/lib/id.ts";
import { log } from "@skrim/shared";

/**
 * In-memory task state manager. One task at a time. NEVER persisted.
 *
 * The module-level `currentTask` variable is the entire state store.
 * On Chrome service worker shutdown, it is lost — which is correct:
 * if the service worker dies mid-task, the task is failed, not resumed.
 */
let currentTask: TaskState | null = null;

class TaskManager {
function assertTask(): TaskState {
  if (!currentTask) throw new Error("No active task");
  return currentTask;
}

export const taskManager = {
  start(goal: string): TaskState {
    const taskId = newTaskId();
    currentTask = {
      taskId,
      status: 'running',
      goal,
      status: "running",
      stepCount: 0,
      maxSteps: DEFAULT_MAX_STEPS,
      observationVersion: 0,
      startedAt: Date.now(),
      timeoutMs: DEFAULT_TIMEOUT_MS
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
    log.info('taskManager.start', { taskId, goal });
    log.info("task.started", { taskId });
    return currentTask;
  }
  },

  cancel(): void {
    if (currentTask) {
      currentTask.status = 'cancelled';
      log.info('taskManager.cancel', { taskId: currentTask.taskId });
    }
  }
    if (!currentTask) return;
    currentTask.status = "cancelled";
    log.info("task.cancelled", { taskId: currentTask.taskId });
  },

  complete(summary: string): void {
    if (currentTask) {
      currentTask.status = 'completed';
      // @ts-ignore - Assuming summary is part of state or loosely handled
      currentTask.summary = summary;
      log.info('taskManager.complete', { taskId: currentTask.taskId, summary });
    }
  }
  complete(): void {
    if (!currentTask) return;
    currentTask.status = "completed";
    log.info("task.completed", {
      taskId: currentTask.taskId,
      steps: currentTask.stepCount,
    });
  },

  fail(errorCode: ErrorCode): void {
    if (currentTask) {
      currentTask.status = 'failed';
      currentTask.lastErrorCode = errorCode;
      log.warn('taskManager.fail', { taskId: currentTask.taskId, errorCode });
    }
  }
    if (!currentTask) return;
    currentTask.status = "failed";
    currentTask.lastErrorCode = errorCode;
    log.warn("task.failed", {
      taskId: currentTask.taskId,
      errorCode,
    });
  },

  /** Returns false when max steps reached. */
  incrementStep(): boolean {
    if (currentTask) {
      currentTask.stepCount++;
      if (currentTask.stepCount >= currentTask.maxSteps) {
        return false;
      }
      return true;
    }
    return false;
  }
    const task = assertTask();
    task.stepCount++;
    return task.stepCount < task.maxSteps;
  },

  incrementObservation(): number {
    if (currentTask) {
      currentTask.observationVersion++;
      return currentTask.observationVersion;
    }
    return 0;
  }
    const task = assertTask();
    task.observationVersion++;
    return task.observationVersion;
  },

  getState(): TaskState | null {
    return currentTask;
  }
  },

  getStatus(): TaskStatus {
    return currentTask ? currentTask.status : 'idle';
  }
    return currentTask?.status ?? "idle";
  },

  isRunning(): boolean {
    return currentTask !== null && currentTask.status === 'running';
  }
    return currentTask?.status === "running";
  },

  /** Wipe all task state. Call after broadcasting final status. */
  clear(): void {
    log.info('taskManager.clear');
    if (currentTask) {
      log.info("task.cleared", { taskId: currentTask.taskId });
    }
    currentTask = null;
  }
}

export const taskManager = new TaskManager();
  },
};
