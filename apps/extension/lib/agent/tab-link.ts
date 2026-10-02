import type { NavigationWatch, PageLink } from "./loop.ts";

/**
 * Connects the agent loop to one browser tab. The tab is fixed when the task
 * starts: if the user switches tabs mid-task, the agent keeps working on the
 * page it was asked about instead of following them.
 */
export function tabLink(tabId: number): PageLink {
  return {
    async send(message) {
      try {
        return await browser.tabs.sendMessage(tabId, message);
      } catch {
        // No content script (a browser page, or a tab opened before the
        // extension loaded), or the page unloaded before it could reply.
        return undefined;
      }
    },

    watchNavigation(): NavigationWatch {
      let started = false;
      let complete = false;
      let onComplete: (() => void) | null = null;
      // `status` is available without the "tabs" permission; url and title are not needed.
      const listener = (updatedTabId: number, change: { status?: string }) => {
        if (updatedTabId !== tabId) return;
        if (change.status === "loading") {
          started = true;
          complete = false;
        } else if (change.status === "complete" && started) {
          complete = true;
          onComplete?.();
        }
      };
      browser.tabs.onUpdated.addListener(listener);
      return {
        get started() {
          return started;
        },
        loaded(ms) {
          if (complete) return Promise.resolve(true);
          return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), ms);
            onComplete = () => {
              clearTimeout(timer);
              resolve(true);
            };
          });
        },
        stop() {
          browser.tabs.onUpdated.removeListener(listener);
        },
      };
    },
  };
}
