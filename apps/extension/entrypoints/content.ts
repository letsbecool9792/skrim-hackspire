import { log } from "@skrim/shared";

/**
 * RUNS IN THE PAGE. Two jobs: build the element graph from the DOM, and execute
 * the eight actions against real elements.
 *
 * Two rules that are not negotiable:
 *
 *  1. NO SITE-SPECIFIC SELECTORS. Ever. Skrim has to work on websites we
 *     have never seen (brief §4.6). Everything routes through the generic element
 *     graph - roles, accessible names, geometry. If you find yourself writing
 *     `.checkout-btn`, stop.
 *
 *  2. Redact before anything leaves this file. Values read out of the DOM are
 *     real user data until the PII pipeline has tokenised them.
 */
export default defineContentScript({
  // Broad by design: we cannot know in advance which sites Skrim will meet.
  // Workstream 1 owns whether this stays a static match or becomes dynamic
  // injection behind activeTab - minimal permissions are a scored signal.
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    log.debug("content.injected");
  },
});
