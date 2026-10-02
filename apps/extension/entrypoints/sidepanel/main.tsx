import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { log } from "@skrim/shared";
import { registerActionPlanner } from "@/lib/integration.ts";
import { createServerPlanner } from "@/lib/agent/server-planner.ts";
import { DashboardFeed, withDashboardFeed, DASHBOARD_URL } from "@/lib/agent/dashboard-feed.ts";
import App from "./App.tsx";
import { SERVER_URL } from "./config.ts";
import "./style.css";

/** Finds the tab the dashboard is open on, or null. */
function getDashboardTabId(): number | null {
  // browser.tabs.query is async but we only need the tab id at send time.
  // Store the last-known id from a periodic scan. Starts null (not open).
  return dashboardTabId;
}

let dashboardTabId: number | null = null;
/** Refresh every 2 s — cheap and covers the tab being opened after the task starts. */
function scanForDashboardTab(): void {
  browser.tabs
    .query({ url: `${DASHBOARD_URL}/*` })
    .then((tabs) => {
      dashboardTabId = tabs[0]?.id ?? null;
    })
    .catch(() => {
      dashboardTabId = null;
    });
}
scanForDashboardTab();
setInterval(scanForDashboardTab, 2_000);

// Create one feed for the lifetime of this side panel.
const feed = new DashboardFeed({ getDashboardTabId });

/**
 * One-line hook for App.tsx: every AgentEvent the loop fires also goes to the
 * dashboard. App.tsx passes this as the onEvent callback alongside its own.
 */
export function onDashboardEvent(event: Parameters<typeof feed.onEvent>[0]): void {
  feed.onEvent(event);
}

// The agent loop runs here, so the planner is registered here. Tests and the
// eval harness register their own.
registerActionPlanner(withDashboardFeed(createServerPlanner(SERVER_URL), feed));
log.info("sidepanel.opened");
// The eval harness's way in (packages/eval). A constant condition, so other
// builds drop the import and the file with it.
if (import.meta.env.MODE === "eval") void import("./eval-hook.ts");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
