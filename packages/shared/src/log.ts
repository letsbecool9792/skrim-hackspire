import { scanForRawPii } from "@skrim/schema";

/**
 * ID-ONLY LOGGING.
 *
 * This is where privacy claims actually die. Not in the redaction pipeline -
 * that gets attention - but in a `console.log(screenGraph)` somebody added at
 * 3am to debug a selector, which then writes a user's email into a log that a
 * crash reporter or support tool later picks up (brief section 7).
 *
 * So: never log values. Log ids, counts, roles, durations, booleans.
 *
 * Use this logger instead of console.* everywhere in the extension. ESLint
 * enforces that. In development, a log line containing something that looks
 * like raw PII THROWS, so you find out immediately rather than on stage. In
 * production the line is dropped entirely and replaced with a warning.
 *
 * Good:  log.info("graph.built", { elements: 47, tokens: 3, ms: 12 })
 * Bad:   log.info("graph.built", { graph })            // objects can hide PII
 * Bad:   log.info("filling", { value: realEmail })     // throws in dev
 */

export type LogField = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogField>;

export type LogLevel = "debug" | "info" | "warn" | "error";

let isDev = true;

/** Call once at startup. Production builds should pass false. */
export function configureLogging(options: { dev: boolean }): void {
  isDev = options.dev;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let minLevel: LogLevel = "debug";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  if (fields) {
    const findings = scanForRawPii(JSON.stringify(fields));
    if (findings.length > 0) {
      const kinds = [...new Set(findings.map((f) => f.kind))].join(", ");
      const message =
        `log.${level}("${event}") was about to write raw PII (${kinds}) to the ` +
        `console. Log ids and counts, never values. See packages/shared/src/log.ts.`;

      // Loud in dev so it is found during development, silent-but-dropped in
      // production so a mistake degrades to a missing log rather than a leak.
      if (isDev) throw new Error(message);
      console.warn(`[skrim] suppressed unsafe log line: ${event} (${kinds})`);
      return;
    }
  }

  const payload = fields ? { event, ...fields } : { event };
  // eslint-disable-next-line no-console -- the single sanctioned console call
  console[level === "debug" ? "log" : level](`[skrim]`, payload);
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};

/**
 * Summarise a collection for logging without exposing its contents.
 * `summarise(elements, e => e.role)` -> { total: 47, button: 12, textbox: 5 }
 */
export function summarise<T>(items: readonly T[], by: (item: T) => string): LogFields {
  const out: LogFields = { total: items.length };
  for (const item of items) {
    const key = by(item);
    out[key] = ((out[key] as number) ?? 0) + 1;
  }
  return out;
}
