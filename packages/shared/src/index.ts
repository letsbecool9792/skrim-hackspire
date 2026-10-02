/**
 * @skrim/shared - cross-cutting utilities.
 *
 * Two rules for this package:
 *   1. It may import @skrim/schema. It may NOT import from any app.
 *   2. Nothing here is allowed to persist anything. No storage, no IndexedDB,
 *      no localStorage. If you need durability, you are solving the wrong
 *      problem - see the vault rules in apps/extension/lib/vault/.
 */

export * from "./log.js";
export * from "./timing.js";
