import { log } from "@skrim/shared";

/**
 * THE ORCHESTRATOR. Owns the observe -> plan -> act -> verify loop, task state,
 * and every call to the planning server.
 *
 * On Chrome this is a SERVICE WORKER, which means:
 *   - NO model inference here. Transformers.js cannot reach WebGPU or WASM in a
 *     service worker (transformers.js#787). Inference goes in entrypoints/offscreen.
 *   - NO DOM. Anything touching the page goes through entrypoints/content.
 *   - It can be killed at any moment. Do not hold important state only here
 *     without a way to rebuild it.
 *
 * On Firefox this is an event page and those limits do not apply - but write for
 * the Chrome constraints, because code that works there works in both.
 */
export default defineBackground(() => {
  log.info("background.started", { browser: import.meta.env.BROWSER });
});
