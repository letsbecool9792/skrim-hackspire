import { defineContentScript } from 'wxt/sandbox';
import { log } from '@skrim/shared';
import { initObserver, getObservationVersion } from './observer.ts';
import { buildRegistry } from './element-registry.ts';
import { executeAction } from '@/lib/actions/dispatcher.ts';
import { parseMessage } from '@/lib/messages.ts';
import { log } from "@skrim/shared";
import { initObserver, getObservationVersion } from "./observer.ts";
import { buildRegistry } from "./element-registry.ts";
import { executeAction } from "@/lib/actions/dispatcher.ts";
import { parseMessage } from "@/lib/messages.ts";

/**
 * RUNS IN THE PAGE. Two jobs: build the element graph from the DOM, and
 * execute the eight actions against real elements.
 *
 * No site-specific selectors. Ever. Skrim has to work on websites
 * we have never seen (brief §4.6).
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    log.debug('content.injected');
    log.debug("content.injected");
    initObserver();

    browser.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
      // Validate incoming message
      const message = parseMessage(rawMessage);
      if (!message) {
        return false;
      }
    // Hold the latest registry across the observe→execute cycle so we
    // resolve element IDs against the same build that produced them.
    let currentRegistry: Map<string, Element> = new Map();

      if (message.type === 'page.observe') {
        const { registry, elements } = buildRegistry();
        const response = {
          type: 'page.observation',
          elementCount: elements.length,
          observationVersion: getObservationVersion(),
          hasVisualCapture: false,
          elements
        };
        sendResponse(response);
        return true;
      }
    browser.runtime.onMessage.addListener(
      (rawMessage: unknown, _sender, sendResponse) => {
        const message = parseMessage(rawMessage);
        if (!message) return false;

      if (message.type === 'action.execute') {
        const { registry } = buildRegistry();
        executeAction(message.action, message.actionId, registry, getObservationVersion)
          .then((result) => {
        if (message.type === "page.observe") {
          const { registry, elements } = buildRegistry();
          currentRegistry = registry;

          log.info("content.observed", {
            elementCount: elements.length,
            version: getObservationVersion(),
          });

          sendResponse({
            type: "page.observation" as const,
            taskId: message.taskId,
            observationVersion: getObservationVersion(),
            elementCount: elements.length,
            hasVisualCapture: false,
          });
          return true;
        }

        if (message.type === "action.execute") {
          // Rebuild registry for action execution to ensure fresh state.
          const { registry } = buildRegistry();
          currentRegistry = registry;

          executeAction(
            message.action,
            message.actionId,
            currentRegistry,
            getObservationVersion,
          ).then((result) => {
            sendResponse({
              type: 'action.result',
              ...result
              type: "action.result" as const,
              ...result,
            });
          });
        return true; // Indicates async response
      }
          return true; // async response
        }

      return false;
    });
        return false;
      },
    );
  },
});
