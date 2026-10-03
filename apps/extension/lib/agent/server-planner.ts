import { assertOutboundSafe, ErrorResponseSchema, PlanResponseSchema } from "@skrim/schema";

import type { ActionPlanner } from "../integration.ts";

/** Longer than the server's own worst case, so its more specific error shows. */
const REQUEST_TIMEOUT_MS = 150_000;

export class PlannerError extends Error {
  constructor(
    readonly code: "unreachable" | "invalid_response" | "invalid_request" | "provider_error" | "provider_rate_limited" | "unparseable_model_output" | "internal",
    message: string,
  ) {
    super(message);
    this.name = "PlannerError";
  }
}

/**
 * `providerKey`: the user's own key for a model picked in the side panel. Sent
 * as a header, never in the request, which the dashboard shows.
 */
export function createServerPlanner(serverUrl: string, providerKey?: string): ActionPlanner {
  return async (request, signal) => {
    // The last line of defence, in the one place that touches the network.
    // Throws on raw PII; the loop stops the task rather than sending.
    assertOutboundSafe(request);

    let response: Response;
    try {
      response = await fetch(`${serverUrl}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(providerKey ? { "X-Provider-Key": providerKey } : {}) },
        body: JSON.stringify(request),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new PlannerError("unreachable", `Could not reach the Skrim server at ${serverUrl}. Is it running? Start it with: pnpm dev:server`);
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ErrorResponseSchema.safeParse(body);
      if (parsed.success) throw new PlannerError(parsed.data.code, parsed.data.error);
      throw new PlannerError("internal", `The server answered HTTP ${response.status}`);
    }
    const parsed = PlanResponseSchema.safeParse(body);
    if (!parsed.success) throw new PlannerError("invalid_response", "The server's reply was not a valid plan");
    return parsed.data;
  };
}

export interface ServerInfo {
  provider: string;
  model: string;
  /** Plans a step when the main provider says to come back later (FALLBACK_PROVIDER). */
  fallback?: { provider: string; model: string };
}

/** The server's health endpoint: which model is planning, or null when unreachable. */
export async function fetchServerInfo(serverUrl: string): Promise<ServerInfo | null> {
  try {
    const response = await fetch(`${serverUrl}/`, { signal: AbortSignal.timeout(3_000) });
    const body = (await response.json()) as Partial<ServerInfo>;
    if (typeof body.provider !== "string" || typeof body.model !== "string") return null;
    const fallback = body.fallback && typeof body.fallback.provider === "string" && typeof body.fallback.model === "string"
      ? { provider: body.fallback.provider, model: body.fallback.model }
      : undefined;
    return { provider: body.provider, model: body.model, ...(fallback ? { fallback } : {}) };
  } catch {
    return null;
  }
}
