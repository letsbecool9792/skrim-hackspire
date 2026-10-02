import { log } from "@skrim/shared";
import { browser } from "wxt/browser";
import {
  OFFSCREEN_PING_MESSAGE,
  OFFSCREEN_PONG_RESPONSE,
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
  return false;
});

