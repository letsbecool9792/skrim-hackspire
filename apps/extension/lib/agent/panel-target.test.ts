import assert from "node:assert/strict";
import { test } from "node:test";

import { panelIsTab, panelTargetFromUrl } from "./panel-target.ts";

test("reads the tab to work on from the panel's address", () => {
  assert.equal(panelTargetFromUrl("moz-extension://abc/sidepanel.html?tab=42"), 42);
  assert.equal(panelIsTab("moz-extension://abc/sidepanel.html?tab=42"), true);
});

test("a side panel has no tab in its address, and junk is not a tab", () => {
  assert.equal(panelTargetFromUrl("chrome-extension://abc/sidepanel.html"), undefined);
  assert.equal(panelTargetFromUrl("moz-extension://abc/sidepanel.html?tab=abc"), undefined);
  assert.equal(panelTargetFromUrl("moz-extension://abc/sidepanel.html?tab=-1"), undefined);
  assert.equal(panelIsTab("chrome-extension://abc/sidepanel.html"), false);
});
