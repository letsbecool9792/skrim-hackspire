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

  test("names a link made only of images by their alt text, skipping hidden icons", () => {
    const { elements } = extract(
      `<a href="/"><img alt="" aria-hidden="true" src="icon.svg"><span><img alt="Wikipedia" src="w.svg"><img alt="The Free Encyclopedia" src="t.svg"></span></a>`
    );

    assert.equal(elements.find((element) => element.role === "link")?.label, "Wikipedia The Free Encyclopedia");
  });

  test("names an icon button by its svg title or an inner aria-label", () => {
    const { elements } = extract(
      `<button><svg><title>Search</title></svg></button><button><span aria-label="Close"></span></button>`
    );

    assert.deepEqual(elements.filter((element) => element.role === "button").map((element) => element.label), ["Search", "Close"]);
  });

  test("keeps the text of a region that holds text itself, like an accordion's panel", () => {
    const { elements } = extract(`<div role="region">More detailed information here.</div>`);

    assert.equal(elements.find((element) => element.role === "region")?.value, "More detailed information here.");
  });

  test("lists only elements in or near the view, and counts the rest", () => {
    const box = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return new DOMRect(10, Number(this.getAttribute("data-y") ?? 10), 100, 20);
    };
    try {
      const { elements, beyondView } = extract(
        `<button data-y="-3000">Far above</button><button data-y="-100">Just above</button><button data-y="300">In view</button><button data-y="5000">Far below</button>`
      );

      assert.deepEqual(elements.map((element) => element.label), ["Just above", "In view"]);
      assert.ok(elements[0]?.state?.includes("offscreen"));
      assert.deepEqual(beyondView, { above: 1, below: 1 });
    } finally {
      Element.prototype.getBoundingClientRect = box;
    }
  });

  test("lists at most 120 elements, the nearest to the view first", () => {
    const box = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return new DOMRect(10, Number(this.getAttribute("data-y") ?? 10), 100, 20);
    };
    try {
      const inView = Array.from({ length: 120 }, (_, index) => `<button data-y="100">In view ${index}</button>`).join("");
      const { elements, beyondView } = extract(`<button data-y="-150">Just above</button>${inView}<button data-y="${window.innerHeight + 50}">Just below</button>`);

      assert.equal(elements.length, 120);
      assert.ok(elements.every((element) => element.label?.startsWith("In view")));
      assert.deepEqual(beyondView, { above: 1, below: 1 });
    } finally {
      Element.prototype.getBoundingClientRect = box;
    }
  });

  test("maps every id back to the element it describes", () => {
    const { elements, registry } = extract(`<button>One</button><button>Two</button>`);

    for (const element of elements) {
      assert.ok(registry.get(element.id), `no registry entry for ${element.id}`);
    }
  });
});
