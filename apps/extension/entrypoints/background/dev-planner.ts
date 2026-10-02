import type { Action, ScreenElement } from "@skrim/schema";
import { log, summarise } from "@skrim/shared";
import type { ActionPlanner } from "@/lib/integration.ts";

/**
 * TEMPORARY. A local planner so the observe -> act -> verify half of the loop
 * can be tested before the server planner is wired in. Delete this file and its
 * registration in index.ts once a planner that calls the server registers itself.
 *
 * It understands one goal shape, "click <text>": it clicks the element whose
 * accessible name contains <text>, then ends the task once that click has been
 * verified. Anything else ends the task with GOAL_NOT_ACHIEVED.
 */

const CLICKABLE_ROLES = new Set<ScreenElement["role"]>([
  "button", "link", "checkbox", "radio", "tab", "menuitem", "option", "combobox",
]);

/** Tasks that have already had their one click. */
const clicked = new Set<string>();

export const devPlanner: ActionPlanner = ({ goal, observation }): Action => {
  const elements = observation.elements ?? [];
  // Counts by role only: labels can contain PII and never go in logs.
  log.info("planner.dev.observation", summarise(elements, (e) => e.role));

  const wanted = /^\s*click\s+(.+?)\s*$/i.exec(goal)?.[1]?.toLowerCase();
  if (!wanted) {
    return { type: "done", success: false, summary: 'The test planner only understands "click <text>".' };
  }

  // Second observation of a task: the click already happened and was verified,
  // otherwise the background would have failed the task instead of observing again.
  if (clicked.delete(observation.taskId)) {
    return { type: "done", success: true, summary: "Clicked the requested element." };
  }

  const matches = (e: ScreenElement) => e.label?.toLowerCase().includes(wanted) ?? false;
  const target = elements.find((e) => CLICKABLE_ROLES.has(e.role) && matches(e)) ?? elements.find(matches);
  if (!target) {
    log.info("planner.dev.noMatch", { elements: elements.length });
    return { type: "done", success: false, summary: "Nothing on the page has that label." };
  }

  clicked.add(observation.taskId);
  log.info("planner.dev.click", { target: target.id, role: target.role });
  return { type: "click", target: target.id, reason: "Test planner: label match" };
};
