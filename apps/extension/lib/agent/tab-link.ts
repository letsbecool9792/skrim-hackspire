import type { NavigationWatch, PageLink } from "./loop.ts";

/** The content script's bundle, as WXT builds it (WXT's types check this path exists). */
const CONTENT_SCRIPT_FILE = "/content-scripts/content.js";

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
      } catch (error) {
        // Nothing listening: a tab that was open before Skrim was installed or
        // reloaded, so the manifest never put the content script in it, or a
        // new page whose copy has not started yet. Start it now rather than
        // ask for a page reload; a second copy stands down by itself. Only to
        // read the page: re-sending an action to a fresh page could repeat it.
        if (message.type !== "page.observe" || !isNoListener(error)) return undefined;
        try {
          await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
          return await browser.tabs.sendMessage(tabId, message);
        } catch {
          // A browser page, or a local file without file access. The loop
          // asks explainTabAccess() for words the user can act on.
          return undefined;
        }
      }
    },

    whyUnreachable: () => explainTabAccess(tabId),

    watchNavigation(): NavigationWatch {
      let started = false;
      let complete = false;
      let onStart: (() => void) | null = null;
      let onComplete: (() => void) | null = null;
      // `status` is available without the "tabs" permission; url and title are not needed.
      const listener = (updatedTabId: number, change: { status?: string }) => {
        if (updatedTabId !== tabId) return;
        if (change.status === "loading") {
          started = true;
          complete = false;
          onStart?.();
        } else if (change.status === "complete" && started) {
          complete = true;
          onComplete?.();
        }
      };
      browser.tabs.onUpdated.addListener(listener);
      const waitFor = (done: () => boolean, set: (callback: (() => void) | null) => void, ms: number) => {
        if (done()) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), ms);
          set(() => {
            clearTimeout(timer);
            resolve(true);
          });
        });
      };
      return {
        get started() {
          return started;
        },
        whenStarted: (ms) => waitFor(() => started, (callback) => { onStart = callback; }, ms),
        loaded: (ms) => waitFor(() => complete, (callback) => { onComplete = callback; }, ms),
        stop() {
          browser.tabs.onUpdated.removeListener(listener);
        },
      };
    },
  };
}

function isNoListener(error: unknown): boolean {
  return /Receiving end does not exist|Could not establish connection/i.test(String(error));
}

const BROWSER_PAGE =
  "This is a browser page, like settings, a new tab or the extension store. Browsers keep every extension off those pages. Open a website and try again.";
const LOCAL_FILE =
  "This is a file on your computer, and Chrome keeps extensions off local files unless you allow it: open chrome://extensions, click Details under Skrim, and turn on “Allow access to file URLs”. Then try again.";
const HIDDEN_TAB =
  "Skrim cannot see this tab. If it is a file on your computer, allow file access: chrome://extensions → Details under Skrim → “Allow access to file URLs”. If it is a browser page (settings, a new tab, the extension store), no extension can work there.";

/**
 * Why Skrim cannot read or capture a tab, in words the user can act on.
 * Skrim has host access to every site, so the only tabs it cannot reach are
 * browser pages and, until the user allows it, local files.
 */
export async function explainTabAccess(tabId: number): Promise<string> {
  let url: string | undefined;
  try {
    url = (await browser.tabs.get(tabId)).url;
  } catch {
    return "That tab is gone. Open the page again and retry.";
  }
  const fileAccess = import.meta.env.FIREFOX ? true : await browser.extension.isAllowedFileSchemeAccess();
  // Without host access to a tab, Chrome hides its URL: that means a browser
  // page, or a local file while file access is off.
  if (url === undefined) return fileAccess ? BROWSER_PAGE : HIDDEN_TAB;
  if (url.startsWith("file:") && !fileAccess) return LOCAL_FILE;
  if (/^(chrome|edge|brave|about|view-source|devtools|chrome-extension|moz-extension):/i.test(url) || /chromewebstore\.google\.com|addons\.mozilla\.org/i.test(url)) {
    return BROWSER_PAGE;
  }
  return "Skrim could not start on this page. Reload it and try again.";
}
