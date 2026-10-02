/**
 * Task limits. The task itself lives in memory in the side panel for as long
 * as it runs (lib/agent/loop.ts), together with its token vault.
 *
 * INVARIANT: task state is NEVER persisted. No chrome.storage, no
 * localStorage, no IndexedDB. The privacy claim is "nothing persists".
 */

export const DEFAULT_MAX_STEPS = 25;

/**
 * The whole task's budget. Generous because a local model can take 5-40 s a
 * step (qwen3-vl:4b on the dev laptop); the server gives up on
 * any single model call after 60 s, 120 s for Ollama.
 */
export const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** Unverified steps in a row before the task stops as NO_PROGRESS. */
export const MAX_CONSECUTIVE_UNVERIFIED = 3;
