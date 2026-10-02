import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PiiCategory } from "@skrim/schema";

import type { PageObservationMessage } from "../messages.ts";
import type { NameFinder } from "../pii/gliner.js";
import { PrivateNames } from "./private-names.ts";

/** A stand-in for GLiNER that finds the given names and addresses wherever they appear. */
function finderFor(entities: Record<string, PiiCategory>): { finder: NameFinder; read: string[] } {
  const read: string[] = [];
  const finder: NameFinder = async (texts) => texts.map((text) => {
    read.push(text);
    return Object.entries(entities).flatMap(([value, category]) => {
      const start = text.toLowerCase().indexOf(value.toLowerCase());
      return start < 0 ? [] : [{ category, source: "ner" as const, confidence: 0.9, text: text.slice(start, start + value.length), start, end: start + value.length }];
    });
  });
  return { finder, read };
}

function page(...texts: string[]): { observation: PageObservationMessage; texts: string[] } {
  const elements = texts.map((label, index) => ({ id: `e${index + 1}`, role: "text" as const, label, bbox: [0, 0, 10, 10] as [number, number, number, number], source: "dom" as const }));
  return { observation: { type: "page.observation", taskId: "t", observationVersion: 0, elementCount: elements.length, hasVisualCapture: false, graphAvailable: true, elements }, texts };
}

const hidden = (lookup: (text: string) => { text: string }[], text: string) => lookup(text).map((candidate) => candidate.text);

describe("PrivateNames", () => {
  test("leaves names on a public page readable, and does not even run the model there", async () => {
    const { finder, read } = finderFor({ "Alan Turing": "NAME" });
    const names = new PrivateNames(finder, () => {});
    const { observation, texts } = page("Alan Turing was a mathematician", "Search Wikipedia");

    const view = await names.preparePage(observation, texts);

    assert.equal(view.personal, false);
    assert.deepEqual(hidden(view.lookup, texts[0]!), []);
    assert.deepEqual(read, []);
  });

  test("hides every name and address on a page that shows the user's data", async () => {
    const { finder } = finderFor({ "Priya Sharma": "NAME", "Karan": "NAME" });
    const names = new PrivateNames(finder, () => {});
    const { observation, texts } = page("Signed in as asha@example.com", "Priya Sharma sent you a file", "Message from Karan");

    const view = await names.preparePage(observation, texts);

    assert.equal(view.personal, true);
    assert.deepEqual(hidden(view.lookup, texts[1]!), ["Priya Sharma"]);
    assert.deepEqual(hidden(view.lookup, texts[2]!), ["Karan"]);
  });

  test("counts a page as personal when a number is labelled by the element before it", async () => {
    const { finder } = finderFor({ "Meera Iyer": "NAME" });
    const names = new PrivateNames(finder, () => {});
    // A <dl>: "Aadhaar" labels the number after it; the number alone is not PII.
    const { observation, texts } = page("Name", "Meera Iyer", "Aadhaar", "2345 6789 0123");

    const view = await names.preparePage(observation, texts);

    assert.equal(view.personal, true);
    assert.deepEqual(hidden(view.lookup, "Meera Iyer"), ["Meera Iyer"]);
  });

  test("hides a name that follows words addressing the user, and the address right after it", async () => {
    const { finder } = finderFor({ "Asha": "NAME", "Rahul Sharma": "NAME", "12 MG Road, Bengaluru": "ADDRESS", "Einstein": "NAME" });
    const names = new PrivateNames(finder, () => {});
    const { observation, texts } = page("Welcome back, Asha", "Deliver to Rahul Sharma, 12 MG Road, Bengaluru", "Einstein wrote to Roosevelt");

    const view = await names.preparePage(observation, texts);

    assert.deepEqual(hidden(view.lookup, texts[0]!), ["Asha"]);
    assert.deepEqual(hidden(view.lookup, texts[1]!), ["Rahul Sharma", "12 MG Road, Bengaluru"]);
    assert.deepEqual(hidden(view.lookup, texts[2]!), []);
  });

  test("once a name is private, hides it everywhere, whatever its case, even earlier on the page", async () => {
    const { finder } = finderFor({ "Asha Rao": "NAME" });
    const names = new PrivateNames(finder, () => {});
    const { observation, texts } = page("ASHA RAO's orders", "Hello, Asha Rao");

    const view = await names.preparePage(observation, texts);

    assert.deepEqual(hidden(view.lookup, texts[0]!), ["ASHA RAO"]);
  });

  test("hides the value of a filled-in name field, and that name elsewhere", async () => {
    const names = new PrivateNames(undefined, () => {});
    const observation: PageObservationMessage = {
      ...page("Your profile: Meera Iyer").observation,
      elements: [
        { id: "e1", role: "text", label: "Your profile: Meera Iyer", bbox: [0, 0, 10, 10], source: "dom" },
        { id: "e2", role: "textbox", label: "Full name", value: "Meera Iyer", bbox: [0, 0, 10, 10], source: "dom" },
      ],
      fields: { e2: { autocomplete: "name" } },
    };

    const view = await names.preparePage(observation, ["Your profile: Meera Iyer", "Full name", "Meera Iyer"]);

    assert.equal(view.personal, true);
    assert.deepEqual(hidden(view.lookup, "Your profile: Meera Iyer"), ["Meera Iyer"]);
  });

  test("in the goal, keeps a public name and hides someone the user deals with", async () => {
    const { finder } = finderFor({ "alan turing": "NAME", "Rahul": "NAME" });
    const names = new PrivateNames(finder, () => {});
    const { observation, texts } = page("Search Wikipedia");
    await names.preparePage(observation, texts);

    assert.deepEqual(hidden(await names.prepareGoal("search for alan turing", false), "search for alan turing"), []);
    assert.deepEqual(hidden(await names.prepareGoal("email Rahul the notes", false), "email Rahul the notes"), ["Rahul"]);
  });

  test("hides every name in the goal when the task starts on a personal page", async () => {
    const { finder } = finderFor({ "Priya": "NAME" });
    const names = new PrivateNames(finder, () => {});

    const lookup = await names.prepareGoal("open the file from Priya", true);

    assert.deepEqual(hidden(lookup, "open the file from Priya"), ["Priya"]);
  });

  test("reports a model that cannot run once, and still hides known names", async () => {
    let failures = 0;
    const names = new PrivateNames(async () => { throw new Error("no model"); }, () => { failures++; });
    const observation: PageObservationMessage = {
      ...page().observation,
      elements: [{ id: "e1", role: "textbox", label: "Full name", value: "Meera Iyer", bbox: [0, 0, 10, 10], source: "dom" }],
      fields: { e1: { autocomplete: "name" } },
    };

    const view = await names.preparePage(observation, ["Full name", "Meera Iyer", "Hi Meera Iyer"]);
    await names.prepareTexts(["Welcome back, Meera"]);

    assert.equal(failures, 1);
    assert.deepEqual(hidden(view.lookup, "Hi Meera Iyer"), ["Meera Iyer"]);
  });
});
