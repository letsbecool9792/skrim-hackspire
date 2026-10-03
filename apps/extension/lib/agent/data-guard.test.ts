import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DataGuard, goalAsksFor } from "./data-guard.ts";

const FORM = "https://forms.example";
const ELSEWHERE = "https://elsewhere.example";

describe("the data guard", () => {
  test("reads which kinds of data a goal asks for", () => {
    assert.equal(goalAsksFor("fill the form with my name and email", "NAME"), true);
    assert.equal(goalAsksFor("fill the form with my name and email", "PHONE"), false);
    assert.equal(goalAsksFor("use my mobile", "PHONE"), true);
    // An email address is not a postal address.
    assert.equal(goalAsksFor("use my email address", "ADDRESS"), false);
    assert.equal(goalAsksFor("ship it to my address", "ADDRESS"), true);
    assert.equal(goalAsksFor("enter my PAN", "GOV_ID"), true);
    assert.equal(goalAsksFor("send support a message", "NAME"), false);
  });

  test("lets a value the goal asks for go back to the site it was seen on", () => {
    const guard = new DataGuard("fill the form with my name and email");
    guard.sawPage(FORM, ["<PII:NAME:1>", "<PII:EMAIL:1>", "<PII:PHONE:1>"]);
    assert.deepEqual(guard.check(["<PII:NAME:1>", "<PII:EMAIL:1>"], FORM), { ask: [], refused: [] });
  });

  test("asks about a value the goal did not ask for", () => {
    const guard = new DataGuard("fill the form with my name and email");
    guard.sawPage(FORM, ["<PII:PHONE:1>"]);
    assert.deepEqual(guard.check(["<PII:PHONE:1>"], FORM).ask, [{ token: "<PII:PHONE:1>", concern: "not-asked" }]);
  });

  test("a value in the goal itself is asked for, on the site the task started on", () => {
    const guard = new DataGuard("sign me up as asha.rao@example.com");
    guard.sawGoal(["<PII:EMAIL:1>"]);
    guard.sawPage(FORM, []);
    assert.deepEqual(guard.check(["<PII:EMAIL:1>"], FORM).ask, []);
    assert.deepEqual(guard.check(["<PII:EMAIL:1>"], ELSEWHERE).ask, [{ token: "<PII:EMAIL:1>", concern: "other-site" }]);
  });

  test("asks before a value seen on one site is typed on another", () => {
    const guard = new DataGuard("send my email to the newsletter");
    guard.sawPage(FORM, ["<PII:EMAIL:1>"]);
    guard.sawPage(ELSEWHERE, []);
    assert.deepEqual(guard.check(["<PII:EMAIL:1>"], ELSEWHERE).ask, [{ token: "<PII:EMAIL:1>", concern: "other-site" }]);
  });

  test("always asks before an ID, card or account number, even one the goal asks for", () => {
    const guard = new DataGuard("fill in my name and PAN");
    guard.sawGoal(["<PII:GOV_ID:1>"]);
    guard.sawPage(FORM, ["<PII:NAME:1>"]);
    assert.deepEqual(guard.check(["<PII:NAME:1>", "<PII:GOV_ID:1>"], FORM).ask, [{ token: "<PII:GOV_ID:1>", concern: "sensitive" }]);
  });

  test("remembers the answer for that value on that site, and only there", () => {
    const guard = new DataGuard("fill in my PAN");
    guard.sawPage(FORM, ["<PII:GOV_ID:1>"]);
    guard.sawPage(ELSEWHERE, ["<PII:GOV_ID:1>", "<PII:PHONE:1>"]);
    guard.decide(["<PII:GOV_ID:1>"], FORM, true);
    assert.deepEqual(guard.check(["<PII:GOV_ID:1>"], FORM), { ask: [], refused: [] });
    assert.equal(guard.check(["<PII:GOV_ID:1>"], ELSEWHERE).ask.length, 1);
    guard.decide(["<PII:PHONE:1>"], ELSEWHERE, false);
    assert.deepEqual(guard.check(["<PII:PHONE:1>"], ELSEWHERE), { ask: [], refused: ["<PII:PHONE:1>"] });
  });
});
