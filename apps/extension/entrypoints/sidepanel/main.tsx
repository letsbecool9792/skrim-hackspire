import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { log } from "@skrim/shared";
import { registerActionPlanner } from "@/lib/integration.ts";
import { createServerPlanner } from "@/lib/agent/server-planner.ts";
import { withDashboardFeed } from "@/lib/agent/dashboard-feed.ts";
import App from "./App.tsx";
import { SERVER_URL } from "./config.ts";
import { feed } from "./feed-instance.ts";
import "./style.css";

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
