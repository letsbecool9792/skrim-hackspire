import { log } from "@skrim/shared";

import { PANEL_TARGET_PARAM } from "@/lib/agent/panel-target.ts";

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
    // toolbar button's click, synchronously. Firefox for Android has no
    // sidebar at all: there the panel opens as a tab of its own, told which
    // tab to work on, since the tab in front will be the panel itself.
    const sidebar = (browser as unknown as { sidebarAction?: { toggle(): Promise<void> } }).sidebarAction;
    browser.action.onClicked.addListener((tab) => {
      if (sidebar) {
        void sidebar.toggle();
        return;
      }
      const url = new URL(browser.runtime.getURL("/sidepanel.html"));
      if (tab.id !== undefined) url.searchParams.set(PANEL_TARGET_PARAM, String(tab.id));
      void browser.tabs.create({ url: url.href }).catch((error: unknown) => {
        log.warn("background.panelTabFailed", { error: String(error) });
      });
    });
  } else {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
      log.warn("background.sidePanelBehaviorFailed", { error: String(error) });
    });
  }
});
