import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { log } from "@skrim/shared";
import { registerActionPlanner } from "@/lib/integration.ts";
import { createServerPlanner } from "@/lib/agent/server-planner.ts";
import App from "./App.tsx";
import { SERVER_URL } from "./config.ts";
import "./style.css";

// The agent loop runs here, so the planner is registered here. Tests and the
// eval harness register their own.
registerActionPlanner(createServerPlanner(SERVER_URL));
log.info("sidepanel.opened");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
