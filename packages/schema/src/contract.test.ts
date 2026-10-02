import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { formatPiiToken, parsePiiToken, isPiiToken, findPiiTokens } from "./pii.js";
import { sanitizeUrl, ScreenGraphSchema, type ScreenGraph } from "./graph.js";
import { ActionSchema, isNavigationAllowed } from "./action.js";
import { scanForRawPii, assertOutboundSafe } from "./guard.js";

/**
 * These tests exist to protect the wire contract. If one fails, something that
 * four other workstreams depend on has changed shape - that is the signal, not
 * a nuisance. Fix the code, or change the test deliberately and say so in the PR.
 */

describe("PII tokens", () => {
  test("round-trips through format and parse", () => {
    const token = formatPiiToken("EMAIL", 1);
    assert.equal(token, "<PII:EMAIL:1>");
    assert.deepEqual(parsePiiToken(token), { category: "EMAIL", index: 1 });
  });

  test("rejects a non-integer or negative index", () => {
    assert.throws(() => formatPiiToken("EMAIL", -1));
    assert.throws(() => formatPiiToken("EMAIL", 1.5));
  });

  test("does not recognise near-miss strings", () => {
    assert.equal(isPiiToken("<PII:EMAIL>"), false);
    assert.equal(isPiiToken("<PII:NOTACATEGORY:1>"), false);
    assert.equal(isPiiToken("PII:EMAIL:1"), false);
    assert.equal(parsePiiToken("suparno@example.com"), null);
  });

  test("finds tokens embedded in surrounding text", () => {
    const found = findPiiTokens("Send to <PII:EMAIL:1> and cc <PII:EMAIL:2>");
    assert.deepEqual(found, ["<PII:EMAIL:1>", "<PII:EMAIL:2>"]);
  });
});

describe("URL sanitisation", () => {
  test("masks numeric ids, uuids and emails in the path", () => {
    const u = sanitizeUrl("https://bank.example/account/8842910/statements");
    assert.equal(u.origin, "https://bank.example");
    assert.equal(u.pathTemplate, "/account/{id}/statements");

    assert.equal(
      sanitizeUrl("https://x.example/u/550e8400-e29b-41d4-a716-446655440000").pathTemplate,
      "/u/{uuid}"
    );
    assert.equal(sanitizeUrl("https://x.example/user/a@b.com").pathTemplate, "/user/{email}");
  });

  test("records that a query existed without carrying its contents", () => {
    const u = sanitizeUrl("https://x.example/search?email=suparno@example.com");
    assert.equal(u.hasQuery, true);
    assert.equal(JSON.stringify(u).includes("suparno"), false);
  });

  test("never throws on a malformed URL", () => {
    assert.equal(sanitizeUrl("not a url").origin, "about:unknown");
  });
});

describe("action schema", () => {
  test("accepts a well-formed type action carrying a token", () => {
    const parsed = ActionSchema.parse({
      type: "type",
      target: "e17",
      value: "<PII:EMAIL:1>",
    });
    assert.equal(parsed.type, "type");
  });

  test("rejects an unknown verb", () => {
    assert.equal(ActionSchema.safeParse({ type: "teleport", target: "e1" }).success, false);
  });

  test("rejects a malformed element id", () => {
    assert.equal(ActionSchema.safeParse({ type: "click", target: "#submit" }).success, false);
    assert.equal(ActionSchema.safeParse({ type: "click", target: "e12" }).success, true);
  });

  test("caps wait duration", () => {
    assert.equal(ActionSchema.safeParse({ type: "wait", ms: 60_000 }).success, false);
  });
});

describe("navigation guard", () => {
  const origin = "https://bank.example";

  test("allows same-origin and relative destinations", () => {
    assert.equal(isNavigationAllowed("/statements", origin), true);
    assert.equal(isNavigationAllowed("https://bank.example/x", origin), true);
    assert.equal(isNavigationAllowed("back", origin), true);
  });

  test("blocks cross-origin destinations", () => {
    assert.equal(isNavigationAllowed("https://evil.example/collect", origin), false);
    assert.equal(isNavigationAllowed("javascript:alert(1)", origin), false);
  });
});

describe("outbound tripwire", () => {
  test("catches a raw email", () => {
    const findings = scanForRawPii(JSON.stringify({ value: "suparno@example.com" }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.kind, "EMAIL");
  });

  test("catches a Luhn-valid card but not an arbitrary long number", () => {
    assert.equal(scanForRawPii("4539578763621486").length, 1);
    assert.equal(scanForRawPii("1234567890123456").length, 0);
  });

  test("never reports the offending value in the finding", () => {
    const findings = scanForRawPii("suparno@example.com");
    assert.equal(JSON.stringify(findings).includes("suparno"), false);
  });

  test("treats a fully tokenised graph as clean", () => {
    const graph: ScreenGraph = {
      cycle: 0,
      url: sanitizeUrl("https://bank.example/account/8842910"),
      title: "Statements",
      viewport: { width: 1280, height: 720 },
      elements: [
        {
          id: "e17",
          role: "textbox",
          label: "Email",
          value: "<PII:EMAIL:1>",
          bbox: [412, 260, 280, 36],
          source: "dom",
          state: ["editable"],
        },
      ],
      manifest: { regions: [], tokensInPlay: ["<PII:EMAIL:1>"] },
    };

    assert.equal(ScreenGraphSchema.safeParse(graph).success, true);
    assert.doesNotThrow(() => assertOutboundSafe(graph));
  });

  test("throws when a raw value survives into the graph", () => {
    const leaky: ScreenGraph = {
      cycle: 0,
      url: sanitizeUrl("https://bank.example/"),
      title: "Statements",
      viewport: { width: 1280, height: 720 },
      elements: [
        {
          id: "e17",
          role: "textbox",
          label: "Email",
          value: "suparno@example.com",
          bbox: [412, 260, 280, 36],
          source: "dom",
        },
      ],
      manifest: { regions: [], tokensInPlay: [] },
    };

    assert.throws(() => assertOutboundSafe(leaky), /unredacted PII/);
  });
});
