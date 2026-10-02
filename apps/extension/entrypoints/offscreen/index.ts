import { log } from "@skrim/shared";
import { browser } from "wxt/browser";

import {
  OFFSCREEN_PING_MESSAGE,
  OFFSCREEN_PONG_RESPONSE,
  recognizeText,
} from "../../lib/vision";

log.info("offscreen.loaded");

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message === OFFSCREEN_PING_MESSAGE ||
    (typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === OFFSCREEN_PING_MESSAGE)
  ) {
    sendResponse(OFFSCREEN_PONG_RESPONSE);
    return true;
  }

  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "skrim:offscreen-ocr"
  ) {
    (async () => {
      try {
        const textRegions = await recognizeText(message.screenshot);

        sendResponse({
          ok: true,
          textRegions,
        });
      } catch (error) {
        log.error("offscreen.ocr.failed", {
          error: error instanceof Error ? error.message : String(error),
        });

        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  }

  return false;
});