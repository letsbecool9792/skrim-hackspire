import { z } from "zod";

/**
 * Structured error codes for action dispatch and task lifecycle.
 *
 * These cross the browser messaging boundary as data, never as thrown
 * exceptions. An uncaught throw in a content script silently disappears;
 * a code in an ActionResult is visible and recoverable.
 */
export const ERROR_CODES = [
  "TARGET_NOT_FOUND",
  "TARGET_NOT_CLICKABLE",
  "ACTION_TIMEOUT",
  "UNSUPPORTED_ACTION",
  "MALFORMED_ACTION",
  "MAX_STEPS_REACHED",
  "TASK_CANCELLED",
  "CONTENT_SCRIPT_ERROR",
  "OBSERVATION_FAILED",
  "NAVIGATION_BLOCKED",
  // The planner ended the task with { type: "done", success: false }.
  "GOAL_NOT_ACHIEVED",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = (typeof ERROR_CODES)[number];

