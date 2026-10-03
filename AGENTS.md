# Skrim Agent Context: Dynamic Permissions & Architecture

This document serves as shared context for agents working on the Skrim repository, specifically regarding the permissions and control architecture (Tasks 01-07).

## Core Philosophy
- Skrim should not compete with frontier models on intelligence. Skrim should control what an AI agent can see, what it can know, what it can do, what must require approval, and what actually happened.
- Models are replaceable. Permissions and execution controls should not be.

## Current Architecture State (Tasks 01-07)
The following foundational control mechanisms have been successfully implemented:

- **TASK_01 (Task-bound Permissions)**: Enforcement is wired through `AgentOptions`. The `TaskPermissions` object acts as a bouncer in `loop.ts`. Before the agent executes an action (like `click`), it checks if the action type is in the `allowedActions` array. If not, the step is rejected locally, without model involvement.
- **TASK_02 (Skrim Rules UI)**: A Settings panel in `App.tsx` allows the user to dynamically toggle the 7 primary action types on/off for the current session.
- **TASK_03 (Server BYOK)**: Users can override the default `runtimeServerUrl` per session in the Settings panel, using `createServerPlanner()` instead of a baked-in planner, ensuring API key and model flexibility.
- **TASK_04 (Action Firewall)**: Extended `commit-guard.ts` to strictly block destructive or high-risk actions unless explicitly asked for. It uses deterministic regex matching on the element label/value to block:
  1. Financial/purchase commitments
  2. Password/credential changes
  3. Sharing/forwarding/publishing data
  4. Form/file uploads
- **TASK_05 (Prompt-Injection Defense)**: A deterministic guard in `App.tsx` runs before the agent loop starts. It caps the goal length at 500 characters and scans for 7 common injection patterns (e.g. "ignore previous instructions", "system prompt").
- **TASK_06 (Privacy Exposure Dashboard)**: Redaction transparency. The `AgentEvent` loop returns counts of hidden PII tokens per step, which are rendered as a privacy badge (e.g. `🛡 2 names hidden`) under the step in the chat.
- **TASK_07 (Task Replay / Audit Trail)**: An in-memory `auditLog` arrays collects the raw event stream. When a task completes, a download button allows exporting the JSON audit trail. Nothing is persisted to `localStorage` or `chrome.storage`.
- **Dynamic System Prompts**: The Settings panel contains a custom instructions textbox. This text flows through `TaskPermissions` into the `PlanRequest` schema and is dynamically injected into the planner's `SYSTEM_PROMPT` on the server (`packages/server/src/prompts/builder.ts`).

## Future Direction: Dynamic Permissions
The permissions model is evolving from static "turn action type on/off" toggles to a more dynamic model:

1. **Specific Guardrails (Current Focus)**: Enforcing strict boundaries on high-risk operations (e.g., stopping password changes, preventing unauthorized form submissions).
2. **User-Specific Instructions / System Prompts (Current Focus)**: Adding a text area in the Settings panel where the user can define custom rules (e.g., "Never click on sponsored links", "Always summarize before acting"). These will be injected into the system prompt for the planning server.
3. **Approval Gating (Upcoming)**: Instead of outright blocking an action, certain high-risk actions (like `submit` or `click` on specific selectors/patterns) will pause the agent loop and prompt the user for explicit YES/NO approval in the chat.
4. **Data-Bound Permissions (Upcoming)**: Tying permissions to specific PII tokens (e.g., "Allow the agent to type, but it requires approval to type <PII:EMAIL:1>").

## Known Issues
- Sometimes the WXT (Vite) dev server (`pnpm --filter @skrim/extension dev`) stalls and fails to apply Hot Module Replacement (HMR) to the side panel. If the UI does not update after saving `App.tsx`, restart the WXT dev server and clear `.vite` cache.
