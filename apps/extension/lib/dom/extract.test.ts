import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { extractScreenGraph } from "./extract.ts";

before(() => {
  GlobalRegistrator.register();
  // happy-dom does no layout, so every element measures 0x0 and would be
  // dropped as invisible. Give everything a size.
  Element.prototype.getBoundingClientRect = function () {
    return { x: 10, y: 10, width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30, toJSON: () => ({}) } as DOMRect;
  };
});

function extract(html: string) {
  document.body.innerHTML = html;
  const graph = extractScreenGraph();
  // A <label> element is named by its own text too, so skip role "text".
  const byLabel = (label: string) => graph.elements.find((element) => element.label === label && element.role !== "text");
  return { ...graph, byLabel };
}

describe("extractScreenGraph", () => {
  test("keeps a button's visible text when its aria-label says something else", () => {
    const { byLabel } = extract(`<button aria-label="Toggle panel">Show Panel</button>`);

    assert.equal(byLabel("Toggle panel")?.value, "Show Panel");
  });

  test("does not repeat visible text that is already the name", () => {
    const { byLabel } = extract(`<button>Details</button>`);

    const button = byLabel("Details");
    assert.equal(button?.role, "button");
    assert.equal(button?.value, undefined);
  });

  test("reads a field's value, and its type and autocomplete for redaction", () => {
    const { byLabel, fields } = extract(
      `<label for="email">Email</label><input id="email" type="email" autocomplete="email" value="someone@example.com">`
    );

    const field = byLabel("Email");
    assert.equal(field?.role, "textbox");
    assert.equal(field?.value, "someone@example.com");
    assert.deepEqual(fields[field!.id], { inputType: "email", autocomplete: "email" });
  });

  test("treats submit inputs as buttons named by their caption", () => {
    const { byLabel } = extract(`<form><input type="submit" value="Sign in"></form>`);

    const button = byLabel("Sign in");
    assert.equal(button?.role, "button");
    assert.equal(button?.value, undefined);
  });

  test("reads a dropdown's choice and lists its options, without the options as elements", () => {
    const { byLabel, elements } = extract(
      `<label for="size">Size</label><select id="size"><option>Small</option><option selected>Large</option></select>`
    );

    const select = byLabel("Size");
    assert.equal(select?.value, "Large");
    assert.equal(select?.hint, "options: Small | Large");
    assert.equal(elements.filter((element) => element.role === "option").length, 0);
  });

  test("describes a checkbox by its state, not a value", () => {
    const { byLabel } = extract(`<input type="checkbox" id="terms"><label for="terms">Accept terms</label>`);

    const checkbox = byLabel("Accept terms");
    assert.equal(checkbox?.role, "checkbox");
    assert.equal(checkbox?.value, undefined);
    assert.ok(checkbox?.state?.includes("unchecked"));
  });

  test("maps every id back to the element it describes", () => {
    const { elements, registry } = extract(`<button>One</button><button>Two</button>`);

    for (const element of elements) {
      assert.ok(registry.get(element.id), `no registry entry for ${element.id}`);
    }
  });
});
