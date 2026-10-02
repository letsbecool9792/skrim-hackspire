import { log } from "@skrim/shared";

/**
 * The background only opens the side panel. The agent loop does not run here:
 * Chrome terminates an extension service worker when a fetch() takes longer
 * than 30 s, and a local model can take that long for one step. It runs in the
 * side panel instead (lib/agent/loop.ts).
 */
export default defineBackground(() => {
  log.info("background.started");

  if (import.meta.env.FIREFOX) {
    // Firefox opens a sidebar only from a user action, so toggle it from the
    // toolbar button's click, synchronously.
    const sidebar = (browser as unknown as { sidebarAction: { toggle(): Promise<void> } }).sidebarAction;
    browser.action.onClicked.addListener(() => {
      void sidebar.toggle();
    });
  } else {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
      log.warn("background.sidePanelBehaviorFailed", { error: String(error) });
    });
  }
});
