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
