/**
 * @skrim/schema - the contract between extension, server and eval harness.
 *
 * All three import from here so the wire format cannot drift. If you change
 * anything in this package, you are changing a contract that four other people
 * are building against: say so in the PR, and expect their code to need updating.
 *
 * Nothing in this package may import from an app. Dependencies point inward.
 */

export * from "./pii.js";
export * from "./element.js";
export * from "./graph.js";
export * from "./action.js";
export * from "./protocol.js";
export * from "./guard.js";
export * from "./dashboard.js";
