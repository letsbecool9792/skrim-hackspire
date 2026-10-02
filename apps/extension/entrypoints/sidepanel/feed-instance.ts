import { DashboardFeed, DASHBOARD_URL } from "@/lib/agent/dashboard-feed.ts";

let dashboardTabId: number | null = null;

function scanForDashboardTab(): void {
  // Querying all tabs and filtering in JS avoids a crash if Chrome strictly
  // requires the "tabs" permission to use the `url` query parameter.
  browser.tabs
    .query({})
    .then((tabs) => {
      const dash = tabs.find((t) => t.url && t.url.startsWith(DASHBOARD_URL));
      dashboardTabId = dash?.id ?? null;
    })
    .catch(() => {
      dashboardTabId = null;
    });
}

scanForDashboardTab();
setInterval(scanForDashboardTab, 2_000);

// Create one feed for the lifetime of this side panel.
export const feed = new DashboardFeed({ getDashboardTabId: () => dashboardTabId });
