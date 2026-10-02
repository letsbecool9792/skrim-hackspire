import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  DashboardMessageSchema,
  DashboardAgentEventSchema,
  ResourcesSchema,
} from "./dashboard.js";
import { sanitizeUrl } from "./graph.js";

/**
 * Tests for the DashboardMessage schema.
 *
 * The contract: every field the dashboard receives is already redacted. Tests
 * confirm the schema accepts safe data and rejects fields that carry raw values.
 */

const baseGraph = {
  cycle: 0,
  url: sanitizeUrl("https://example.org/"),
  title: "Home",
  viewport: { width: 1280, height: 720 },
  elements: [],
  manifest: { regions: [], tokensInPlay: [] },
};

const baseRequest = {
  goal: "Send a message using <PII:EMAIL:1>",
  graph: baseGraph,
  history: [],
};

const baseResponse = {
  action: { type: "done", success: true, summary: "done" },
  model: "qwen/qwen3.8-27b",
  latencyMs: 450,
  repairs: 0,
};

const baseMessage = {
  __skrimDashboard: true as const,
  sentAt: new Date().toISOString(),
  event: { type: "started" as const, taskId: "t1", redactedGoal: "Send <PII:EMAIL:1>" },
};

describe("DashboardMessage schema", () => {
  test("accepts a minimal started message", () => {
    const result = DashboardMessageSchema.safeParse(baseMessage);
    assert.equal(result.success, true, JSON.stringify(result));
  });

  test("accepts a planned message with request and response", () => {
    const msg = {
      ...baseMessage,
      event: {
        type: "planned" as const,
        step: 0,
        actionType: "click",
        targetLabel: "Submit",
        model: "qwen/qwen3.8-27b",
        latencyMs: 450,
      },
      request: baseRequest,
      response: baseResponse,
    };
    assert.equal(DashboardMessageSchema.safeParse(msg).success, true);
  });

  test("accepts a finished event with token counts, not values", () => {
    const msg = {
      ...baseMessage,
      event: {
        type: "finished" as const,
        outcome: "completed" as const,
        steps: 3,
        tokens: { EMAIL: 1, NAME: 1 },
      },
    };
    assert.equal(DashboardMessageSchema.safeParse(msg).success, true);
  });

  test("accepts an observed event with redaction counts", () => {
    const msg = {
      ...baseMessage,
      event: {
        type: "observed" as const,
        step: 0,
        elements: 12,
        redactions: { EMAIL: 1, PHONE: 0 },
        page: "https://example.org/form",
      },
    };
    assert.equal(DashboardMessageSchema.safeParse(msg).success, true);
  });

  test("accepts an observed event with optional stage timings", () => {
    const msg = {
      ...baseMessage,
      event: {
        type: "observed" as const,
        step: 1,
        elements: 8,
        redactions: {},
        page: "https://example.org/",
        stageTimingsMs: { observe: 120, names: 250, redact: 5 },
      },
    };
    assert.equal(DashboardMessageSchema.safeParse(msg).success, true);
  });

  test("rejects a message without the __skrimDashboard discriminator", () => {
    const bad = { sentAt: new Date().toISOString(), event: baseMessage.event };
    assert.equal(DashboardMessageSchema.safeParse(bad).success, false);
  });

  test("rejects an unknown event type", () => {
    const bad = { ...baseMessage, event: { type: "teleported", step: 0 } };
    assert.equal(DashboardMessageSchema.safeParse(bad).success, false);
  });
});

describe("ResourcesSchema", () => {
  test("accepts full resource snapshot", () => {
    const r = {
      modelFiles: [
        { name: "gliner-pii/model_quint8.onnx", sizeBytes: 45_000_000, backend: "wasm" },
      ],
      jsHeapBytes: 50_000_000,
      jsHeapLimitBytes: 2_000_000_000,
      steps: 3,
      promptTokens: 4500,
      completionTokens: 120,
      roundTripMs: 520,
      modelLatencyMs: 450,
    };
    assert.equal(ResourcesSchema.safeParse(r).success, true);
  });

  test("accepts resources without optional heap and timing fields", () => {
    const r = { modelFiles: [], steps: 0, promptTokens: 0, completionTokens: 0 };
    assert.equal(ResourcesSchema.safeParse(r).success, true);
  });

  test("rejects a negative step count", () => {
    const r = { modelFiles: [], steps: -1, promptTokens: 0, completionTokens: 0 };
    assert.equal(ResourcesSchema.safeParse(r).success, false);
  });
});

describe("DashboardAgentEvent variants", () => {
  test("warning event", () => {
    assert.equal(
      DashboardAgentEventSchema.safeParse({ type: "warning", message: "NER failed" }).success,
      true,
    );
  });

  test("acted event verified and unverified", () => {
    assert.equal(
      DashboardAgentEventSchema.safeParse({ type: "acted", step: 0, verified: true }).success,
      true,
    );
    assert.equal(
      DashboardAgentEventSchema.safeParse({
        type: "acted",
        step: 1,
        verified: false,
        note: "the page did not change",
      }).success,
      true,
    );
  });
});
