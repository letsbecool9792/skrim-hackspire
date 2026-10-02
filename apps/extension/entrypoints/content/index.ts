import { defineContentScript } from "#imports";
import { log } from "@skrim/shared";
import { initObserver, getObservationVersion } from "./observer.ts";
import { createContentHandler } from "@/lib/content-handler.ts";
import { domScreenGraphProvider } from "@/lib/dom/provider.ts";
import { registerScreenGraphProvider } from "@/lib/integration.ts";
import { parseMessage } from "@/lib/messages.ts";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    // The side panel injects this script into tabs that were open before
    // Skrim loaded (lib/agent/tab-link.ts), and a page can get it from the
    // manifest as well. One live copy per page: a second would answer every
    // message twice. A copy orphaned by an extension reload is not live, and
    // must not block the new one.
    const page = globalThis as { __skrimContentAlive?: () => boolean };
    if (page.__skrimContentAlive?.()) return;
    page.__skrimContentAlive = () => {
      try {
        return browser.runtime.id !== undefined;
      } catch {
        return false;
      }
    };

    initObserver();
    // WS2's DOM extractor supplies the graph. It must be registered in this
    // content-script context, because that is where the handler asks for it.
    registerScreenGraphProvider(domScreenGraphProvider);
    const handle = createContentHandler(getObservationVersion);
    browser.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
      const message = parseMessage(rawMessage);
      if (!message || (message.type !== "page.observe" && message.type !== "action.execute")) return false;
      void handle(message).then(sendResponse);
      return true;
    });
    log.info("content.injected");
  },
});
