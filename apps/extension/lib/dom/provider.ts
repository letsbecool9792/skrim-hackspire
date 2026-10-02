import type { ScreenGraphProvider } from "../integration";
import { extractScreenGraph } from "./extract";

/**
 * WS2's screen-graph provider for WS1's `registerScreenGraphProvider` hook.
 *
 * The content script registers this once. When the background asks the page to
 * observe, WS1 calls it, keeps `registry` for resolving action targets, and
 * forwards `elements` to the background.
 *
 * DOM only for now: vision fusion (lib/vision) is not wired in, so
 * `hasVisualCapture` is always false.
 */
export const domScreenGraphProvider: ScreenGraphProvider = () => ({
  ...extractScreenGraph(),
  hasVisualCapture: false,
});
