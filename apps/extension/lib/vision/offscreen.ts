/// <reference types="chrome" />

import { browser } from "wxt/browser";
import {
  OFFSCREEN_PING_MESSAGE,
  OFFSCREEN_PONG_RESPONSE,
  type OffscreenPongResponse,
} from "./contract";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

let creatingOffscreenPromise: Promise<void> | null = null;

/**
 * Checks whether an offscreen document is currently active.
 */
export async function hasOffscreenDocument(): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.offscreen) {
    return false;
  }
  if (typeof chrome.offscreen.hasDocument === "function") {
    return await chrome.offscreen.hasDocument();
  }
  if (typeof chrome.runtime?.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    return contexts.length > 0;
  }
  return false;
}

/**
 * Ensures that the Chrome offscreen document exists.
 * Idempotent: safe against concurrent calls and does not create duplicate documents.
 * In environments without chrome.offscreen (e.g. Firefox MV3 event pages), this is a no-op.
 */
export async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.offscreen) {
    return;
  }

  if (await hasOffscreenDocument()) {
    return;
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = createOffscreenDocumentInternal().finally(() => {
    creatingOffscreenPromise = null;
  });

  await creatingOffscreenPromise;
}

async function createOffscreenDocumentInternal(): Promise<void> {
  if (await hasOffscreenDocument()) {
    return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Local model inference for visual perception",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Only a single offscreen document may be created")) {
      return;
    }
    throw err;
  }
}

/**
 * Closes the offscreen document if currently active.
 */
export async function closeOffscreenDocument(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.offscreen) {
    return;
  }
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

/**
 * Sends a message to the offscreen document, ensuring the document is created first.
 */
export async function sendOffscreenMessage<T = unknown>(message: unknown): Promise<T> {
  await ensureOffscreenDocument();
  return (await browser.runtime.sendMessage(message)) as T;
}

/**
 * Health check ping to verify the offscreen document is reachable.
 * Sends "skrim:offscreen:ping" and expects "skrim:offscreen:pong".
 */
export async function pingOffscreen(): Promise<OffscreenPongResponse> {
  const response = await sendOffscreenMessage<OffscreenPongResponse>(OFFSCREEN_PING_MESSAGE);
  if (response !== OFFSCREEN_PONG_RESPONSE) {
    throw new Error(`Unexpected offscreen response: ${String(response)}`);
  }
  return response;
}
