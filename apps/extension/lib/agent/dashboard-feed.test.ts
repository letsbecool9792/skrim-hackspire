import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DashboardMessageSchema, sanitizeUrl, type DashboardMessage, type PlanRequest, type PlanResponse } from "@skrim/schema";

import { DashboardFeed, withDashboardFeed } from "./dashboard-feed.ts";

/**
 * The feed in Node: what reaches the dashboard tab, and what never does. The
 * tab is a function that records what it was sent.
 */

function feedWithTab(tabId: number | null = 7) {
  const sent: DashboardMessage[] = [];
  const feed = new DashboardFeed({
    getDashboardTabId: () => tabId,
    getContext: () => ({ modelFiles: [{ name: "gliner-pii", sizeBytes: 49_430_711, backend: "wasm" }], planner: { provider: "groq", model: "qwen/qwen3.8-27b" } }),
    sendToTab: async (_id, message) => {
      sent.push((message as { payload: DashboardMessage }).payload);
    },
  });
  return { feed, sent };
}

const request: PlanRequest = {
  goal: "Put my email in the field",
  graph: {
    cycle: 0,
    url: sanitizeUrl("https://shop.example/account"),
    title: "Account",
    viewport: { width: 1280, height: 720 },
    elements: [{ id: "e1", role: "textbox", label: "Email", value: "<PII:EMAIL:1>", bbox: [0, 0, 100, 20], source: "dom" }],
    manifest: { regions: [], tokensInPlay: ["<PII:EMAIL:1>"] },
  },
  history: [],
};
const response: PlanResponse = { action: { type: "type", target: "e1", value: "<PII:EMAIL:1>" }, model: "qwen/qwen3.8-27b", latencyMs: 400, repairs: 0 };

describe("DashboardFeed", () => {
  test("sends each kind of step in the dashboard's format, with the page reading's timings", async () => {
    const { feed, sent } = feedWithTab();

    feed.onEvent({ type: "started", taskId: "t1", redactedGoal: "Put <PII:EMAIL:1> in the field" });
    feed.onEvent({ type: "observed", step: 0, elements: 1, redactions: { EMAIL: 1 }, page: "https://shop.example/account", timings: { observeMs: 4.6, visionMs: 0, namesMs: 212.3, redactMs: 0.4 } });
    feed.onEvent({ type: "acted", step: 0, verified: false, note: "the page did not change", message: "Nothing changed on the page." });
    feed.onEvent({ type: "finished", outcome: "completed", steps: 1, tokens: { EMAIL: 1 }, summary: "Typed <PII:EMAIL:1>" });
    await Promise.resolve();

    assert.deepEqual(sent.map((message) => message.event.type), ["started", "observed", "acted", "finished"]);
    for (const message of sent) assert.equal(DashboardMessageSchema.safeParse(message).success, true);
    const observed = sent[1]!.event;
    assert.deepEqual(observed.type === "observed" && observed.stageTimingsMs, { observe: 5, pixels: 0, names: 212, redact: 0 });
    const acted = sent[2]!.event;
    assert.equal(acted.type === "acted" && acted.message, "Nothing changed on the page.");
    assert.equal(sent[0]!.resources?.planner?.provider, "groq");
    assert.equal(sent[0]!.resources?.modelFiles[0]?.name, "gliner-pii");
  });

  test("sends the request and reply exactly as the planner saw them, with a planned step", async () => {
    const { feed, sent } = feedWithTab();
    const planner = withDashboardFeed(async () => response, feed);

    await planner(request, new AbortController().signal);
    feed.onEvent({ type: "planned", step: 0, action: response.action, targetLabel: "Email", model: response.model, latencyMs: 400 });
    await Promise.resolve();

    assert.deepEqual(sent[0]?.request, request);
    assert.deepEqual(sent[0]?.response, response);
    assert.equal(sent[0]?.resources?.steps, 1);
  });

  test("holds back any message that still carries raw personal data", async () => {
    const { feed, sent } = feedWithTab();

    // A summary the detectors missed: the dashboard must not show it either.
    feed.onEvent({ type: "finished", outcome: "completed", steps: 1, tokens: {}, summary: "Sent it to asha.rao@example.com" });
    await Promise.resolve();

    assert.equal(sent.length, 0);
  });

  test("sends nothing when no dashboard tab is open", async () => {
    const { feed, sent } = feedWithTab(null);

    feed.onEvent({ type: "started", taskId: "t1", redactedGoal: "Go" });
    feed.heartbeat();
    await Promise.resolve();

    assert.equal(sent.length, 0);
  });

  test("a heartbeat says the panel is open and carries the resources", async () => {
    const { feed, sent } = feedWithTab();

    feed.heartbeat();
    await Promise.resolve();

    assert.equal(sent[0]?.event.type, "heartbeat");
    assert.equal(DashboardMessageSchema.safeParse(sent[0]).success, true);
    assert.equal(sent[0]?.resources?.planner?.model, "qwen/qwen3.8-27b");
  });
});
