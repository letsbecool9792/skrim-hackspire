import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TokenVault } from "./vault.js";

describe("TokenVault", () => {
  test("creates and resolves a token", () => {
    const vault = new TokenVault();

    const token = vault.set("EMAIL", "user@example.com");

    assert.equal(token, "<PII:EMAIL:1>");
    assert.equal(vault.resolve(token), "user@example.com");
  });

  test("reuses a token for the same value within a category", () => {
    const vault = new TokenVault();

    const firstToken = vault.set("EMAIL", "user@example.com");
    const secondToken = vault.set("EMAIL", "user@example.com");

    assert.equal(firstToken, secondToken);
    assert.deepEqual(vault.stats(), { EMAIL: 1 });
  });

  test("gives one token to a value however it is written, and types back the first spelling", () => {
    const vault = new TokenVault();

    const fromGoal = vault.set("NAME", "alan turing");
    const fromPage = vault.set("NAME", "Alan  Turing");
    const phone = vault.set("PHONE", "+91 98765 43210");

    assert.equal(fromGoal, fromPage);
    assert.equal(vault.resolve(fromPage), "alan turing");
    assert.equal(vault.set("PHONE", "+919876543210"), phone);
    assert.notEqual(vault.set("NAME", "Alan Turner"), fromGoal);
  });

  test("keeps categories separate", () => {
    const vault = new TokenVault();

    const emailToken = vault.set("EMAIL", "same-value");
    const phoneToken = vault.set("PHONE", "same-value");

    assert.equal(emailToken, "<PII:EMAIL:1>");
    assert.equal(phoneToken, "<PII:PHONE:1>");
    assert.deepEqual(vault.stats(), { EMAIL: 1, PHONE: 1 });
  });

  test("clears values and resets the task scope", () => {
    const vault = new TokenVault();
    const oldToken = vault.set("EMAIL", "user@example.com");

    vault.clear();

    assert.equal(vault.resolve(oldToken), undefined);
    assert.deepEqual(vault.stats(), {});
    assert.equal(vault.set("EMAIL", "new@example.com"), "<PII:EMAIL:1>");
  });

  test("returns undefined for an unknown token", () => {
    const vault = new TokenVault();

    assert.equal(vault.resolve("<PII:EMAIL:1>"), undefined);
  });
});