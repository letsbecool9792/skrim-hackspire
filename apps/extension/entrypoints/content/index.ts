import { defineContentScript } from "#imports";
import { log } from "@skrim/shared";
import { initObserver, getObservationVersion } from "./observer.ts";
import { executeAction } from "@/lib/actions/dispatcher.ts";
import { domScreenGraphProvider } from "@/lib/dom/provider.ts";
import { getScreenGraphProvider, getTokenResolver, registerScreenGraphProvider } from "@/lib/integration.ts";
import { parseMessage } from "@/lib/messages.ts";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    initObserver();
    // WS2's DOM extractor supplies the graph. It must be registered in this
    // content-script context, because that is where getScreenGraphProvider()
    // is called on page.observe.
    registerScreenGraphProvider(domScreenGraphProvider);
    let currentRegistry = new Map<string, Element>();
    browser.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
      const message = parseMessage(rawMessage);
      if (!message) return false;
      if (message.type === "page.observe") {
        const provider = getScreenGraphProvider();
        if (!provider) {
          sendResponse({ type: "page.observation", taskId: message.taskId, observationVersion: getObservationVersion(), elementCount: 0, hasVisualCapture: false, graphAvailable: false });
          return true;
        }
        void Promise.resolve(provider()).then((result) => {
          currentRegistry = result.registry;
          sendResponse({ type: "page.observation", taskId: message.taskId, observationVersion: getObservationVersion(), elementCount: result.elements.length, hasVisualCapture: result.hasVisualCapture, graphAvailable: true, elements: result.elements });
        });
        return true;
      }
      if (message.type === "action.execute") {
        void executeAction(message.action, message.actionId, currentRegistry, getObservationVersion, { resolveToken: getTokenResolver() }).then((result) => sendResponse({ type: "action.result", taskId: message.taskId, ...result }));
        return true;
      }
      return false;
    });
    log.info("content.injected");
  },
});
