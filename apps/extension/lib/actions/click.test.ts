import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { executeClick } from "./click.ts";

let version = 0;
const getVersion = () => version;

before(() => {
  GlobalRegistrator.register();
  Element.prototype.getBoundingClientRect = function () {
    return { x: 10, y: 10, width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30, toJSON: () => ({}) } as DOMRect;
  };
  Element.prototype.scrollIntoView = () => {};
  // Stands in for the content script's MutationObserver-driven counter.
  new MutationObserver(() => { version += 1; }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
});

/** Inserts the markup and waits for its own mutations to be counted, so they are not mistaken for the click's. */
async function mount(html: string): Promise<HTMLElement> {
  document.body.innerHTML = html;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return document.body.firstElementChild as HTMLElement;
}

describe("executeClick", () => {
  test("verifies a click that changes the page", async () => {
    const button = await mount(`<button>Count: 0</button>`);
    button.addEventListener("click", () => { button.textContent = "Count: 1"; });

    const result = await executeClick("e1", "a0", new Map([["e1", button]]), getVersion);

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(button.textContent, "Count: 1");
  });

  test("does not verify a click that changed nothing, even though the button took focus", async () => {
    const button = await mount(`<button>Does nothing</button>`);

    const result = await executeClick("e1", "a0", new Map([["e1", button]]), getVersion);

    assert.equal(document.activeElement, button);
    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
  });

  test("verifies a checkbox by its checked state", async () => {
    const checkbox = (await mount(`<input type="checkbox">`)) as HTMLInputElement;

    const result = await executeClick("e1", "a0", new Map([["e1", checkbox]]), getVersion);

    assert.equal(checkbox.checked, true);
    assert.equal(result.changed, true);
  });

  test("refuses a disabled button", async () => {
    const button = await mount(`<button disabled>Pay</button>`);

    const result = await executeClick("e1", "a0", new Map([["e1", button]]), getVersion);

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "TARGET_NOT_CLICKABLE");
  });

  test("reports an element that has left the page", async () => {
    const button = await mount(`<button>Gone</button>`);
    button.remove();

    const result = await executeClick("e1", "a0", new Map([["e1", button]]), getVersion);

    assert.equal(result.errorCode, "TARGET_NOT_FOUND");
  });
});
