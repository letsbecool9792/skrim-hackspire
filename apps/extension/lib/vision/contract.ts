/**
 * Runtime message contract for offscreen document health check and communication.
 * Kept small and deterministic.
 */

export const OFFSCREEN_PING_MESSAGE = "skrim:offscreen:ping" as const;
export const OFFSCREEN_PONG_RESPONSE = "skrim:offscreen:pong" as const;

export type OffscreenPingMessage = typeof OFFSCREEN_PING_MESSAGE;
export type OffscreenPongResponse = typeof OFFSCREEN_PONG_RESPONSE;

export interface OffscreenPingPayload {
  type: typeof OFFSCREEN_PING_MESSAGE;
}

export type OffscreenRequest = OffscreenPingMessage | OffscreenPingPayload;
export type OffscreenResponse = OffscreenPongResponse;

