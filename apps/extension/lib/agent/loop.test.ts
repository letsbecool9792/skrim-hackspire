import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { assertOutboundSafe, type Action, type PlanRequest, type PlanResponse } from "@skrim/schema";

import { getObservationVersion, initObserver } from "../../entrypoints/content/observer.ts";
import { createContentHandler } from "../content-handler.ts";
import { domScreenGraphProvider } from "../dom/provider.ts";
import { registerScreenGraphProvider, type ActionPlanner } from "../integration.ts";
import type { NameFinder } from "../pii/gliner.js";
import { runAgentTask, type AgentEvent, type PageLink } from "./loop.ts";

/**
 * The whole loop in Node: the real content-side handler, DOM extractor, action
 * executor, redaction and vault, against a page in happy-dom. Only the planner
 * is scripted, and the browser's messaging is replaced by a JSON round trip.
 */

before(() => {
  GlobalRegistrator.register();
  Element.prototype.getBoundingClientRect = function () {
    return { x: 10, y: 10, width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30, toJSON: () => ({}) } as DOMRect;
  };
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML = "<main></main>";
  initObserver();
  registerScreenGraphProvider(domScreenGraphProvider);
});

const handle = createContentHandler(getObservationVersion);
const link: PageLink = {
  // Like browser messaging: only JSON-safe data crosses.
  send: async (message) => JSON.parse(JSON.stringify((await handle(JSON.parse(JSON.stringify(message)))) ?? null)) ?? undefined,
  watchNavigation: () => ({ started: false, whenStarted: async () => false, loaded: async () => true, stop: () => {} }),
};

async function page(html: string): Promise<void> {
  document.body.innerHTML = html;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A planner that answers from a script and keeps every request it was sent. */
function scripted(next: (request: PlanRequest, step: number) => Action): { planner: ActionPlanner; requests: PlanRequest[] } {
  const requests: PlanRequest[] = [];
  const planner: ActionPlanner = async (request) => {
    requests.push(request);
    return { action: next(request, requests.length - 1), model: "scripted", latencyMs: 1, repairs: 0 } satisfies PlanResponse;
  };
  return { planner, requests };
}

const idOf = (request: PlanRequest, label: string) => {
  const element = request.graph.elements.find((e) => e.label === label && e.role !== "text");
  assert.ok(element, `no element labelled ${label}`);
  return element.id;
};

async function run(goal: string, planner: ActionPlanner, signal = new AbortController().signal) {
  const events: AgentEvent[] = [];
  await runAgentTask({ goal, planner, link, signal, onEvent: (event) => events.push(event) });
  const finished = events.at(-1);
  assert.equal(finished?.type, "finished");
  return { events, finished: finished as Extract<AgentEvent, { type: "finished" }> };
}

describe("runAgentTask", () => {
  test("clicks, sees the page change, and finishes when the planner says done", async () => {
    await page(`<button aria-label="Increment counter">Count: 0</button>`);
    const counter = document.querySelector("button")!;
    counter.addEventListener("click", () => { counter.textContent = "Count: 1"; });
    const { planner, requests } = scripted((request, step) =>
      step === 0 ? { type: "click", target: idOf(request, "Increment counter") } : { type: "done", success: true, summary: "Clicked once" });

    const { finished } = await run("Increment the counter once", planner);

    assert.equal(counter.textContent, "Count: 1");
    assert.equal(finished.outcome, "completed");
    assert.equal(finished.steps, 1);
    assert.deepEqual(requests[1]?.history.map((s) => s.verified), [true]);
    assert.equal(requests[1]?.graph.elements.find((e) => e.label === "Increment counter")?.value, "Count: 1");
  });

  test("sends only tokens, and types the real value when the planner uses one", async () => {
    await page(`<p>Signed in as someone@example.com</p><label for="email">Email</label><input id="email" type="email">`);
    const { planner, requests } = scripted((request, step) =>
      step === 0 ? { type: "type", target: idOf(request, "Email"), value: "<PII:EMAIL:1>" } : { type: "done", success: true, summary: "Filled" });

    const { finished } = await run("Put my email in the email field", planner);

    assert.equal(finished.outcome, "completed");
    assert.equal((document.querySelector("#email") as HTMLInputElement).value, "someone@example.com");
    for (const request of requests) {
      assert.doesNotMatch(JSON.stringify(request), /someone@example\.com/);
      assert.doesNotThrow(() => assertOutboundSafe(request));
    }
    assert.deepEqual(requests[0]?.graph.manifest.tokensInPlay, ["<PII:EMAIL:1>"]);
    // Next view: the field now holds the address, and shows as the same token.
    assert.equal(requests[1]?.graph.elements.find((e) => e.label === "Email" && e.role === "textbox")?.value, "<PII:EMAIL:1>");
  });

  test("redacts PII in the goal itself", async () => {
    await page(`<button>Send</button>`);
    const { planner, requests } = scripted(() => ({ type: "done", success: true, summary: "ok" }));

    await run("Send an invite to friend@example.org", planner);

    assert.equal(requests[0]?.goal, "Send an invite to <PII:EMAIL:1>");
  });

  test("hides names the name finder reports, in the goal and on the page", async () => {
    await page(`<p>Signed in as Asha Rao</p><button>Log out</button>`);
    const findNames: NameFinder = async (texts) => texts.map((text) => {
      const start = text.indexOf("Asha Rao");
      return start === -1 ? [] : [{ category: "NAME", source: "ner", confidence: 0.9, text: "Asha Rao", start, end: start + 8 }];
    });
    const { planner, requests } = scripted(() => ({ type: "done", success: true, summary: "ok" }));
    const events: AgentEvent[] = [];

    await runAgentTask({ goal: "Log Asha Rao out", planner, link, signal: new AbortController().signal, onEvent: (e) => events.push(e), findNames });

    assert.doesNotMatch(JSON.stringify(requests[0]), /Asha Rao/);
    assert.equal(requests[0]?.goal, "Log <PII:NAME:1> out");
    assert.ok(requests[0]?.graph.elements.some((e) => e.label === "Signed in as <PII:NAME:1>"));
  });

  test("hides the goal's names everywhere, and leaves other public names readable", async () => {
    await page(`<p>Alan Turing was a mathematician</p><p>Winston Churchill praised the codebreakers</p><input type="search" aria-label="Search">`);
    const people = ["alan turing", "winston churchill"];
    const findNames: NameFinder = async (texts) => texts.map((text) => people.flatMap((person) => {
      const start = text.toLowerCase().indexOf(person);
      return start === -1 ? [] : [{ category: "NAME" as const, source: "ner" as const, confidence: 0.9, text: text.slice(start, start + person.length), start, end: start + person.length }];
    }));
    const { planner, requests } = scripted(() => ({ type: "done", success: true, summary: "ok" }));

    await runAgentTask({ goal: "search for alan turing", planner, link, signal: new AbortController().signal, onEvent: () => {}, findNames });

    assert.equal(requests[0]?.goal, "search for <PII:NAME:1>");
    const labels = requests[0]?.graph.elements.map((e) => e.label);
    assert.ok(labels?.includes("<PII:NAME:1> was a mathematician"));
    assert.ok(labels?.includes("Winston Churchill praised the codebreakers"));
  });

  test("warns and carries on when the name finder cannot start", async () => {
    await page(`<button>Go</button>`);
    const { planner } = scripted(() => ({ type: "done", success: true, summary: "ok" }));
    const events: AgentEvent[] = [];

    await runAgentTask({ goal: "Go", planner, link, signal: new AbortController().signal, onEvent: (e) => events.push(e), findNames: async () => { throw new Error("no model"); } });

    assert.ok(events.some((e) => e.type === "warning" && /NOT being hidden/.test(e.message)));
    assert.equal(events.at(-1)?.type === "finished" && events.at(-1)?.type, "finished");
  });

  test("never types a token the task did not issue", async () => {
    await page(`<label for="email">Email</label><input id="email" type="email">`);
    const { planner, requests } = scripted((request, step) =>
      step === 0 ? { type: "type", target: idOf(request, "Email"), value: "<PII:EMAIL:9>" } : { type: "done", success: false, summary: "gave up" });

    await run("Fill in the email", planner);

    assert.equal((document.querySelector("#email") as HTMLInputElement).value, "");
    assert.equal(requests[1]?.history[0]?.verified, false);
    assert.match(requests[1]?.history[0]?.note ?? "", /not typed/);
  });

  test("stops when several steps in a row change nothing", async () => {
    await page(`<button>Does nothing</button>`);
    const { planner, requests } = scripted((request) => ({ type: "click", target: idOf(request, "Does nothing") }));

    const { finished } = await run("Make something happen", planner);

    assert.equal(finished.errorCode, "NO_PROGRESS");
    assert.equal(requests.length, 3);
    assert.equal(requests[2]?.history.at(-1)?.note, "the page did not change");
  });

  test("stops when the page keeps coming back to the same state", async () => {
    await page(`<button aria-label="Toggle panel" aria-expanded="false">Show Panel</button>`);
    const toggle = document.querySelector("button")!;
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Hide Panel" : "Show Panel";
    });
    const { planner, requests } = scripted((request) => ({ type: "click", target: idOf(request, "Toggle panel") }));

    const { finished } = await run("Click show panel", planner);

    assert.equal(finished.errorCode, "NO_PROGRESS");
    assert.match(finished.message ?? "", /going in circles/);
    // Closed, open, closed, open, closed: the third arrival at "closed" stops it.
    assert.equal(requests.length, 4);
  });

  test("tells the planner what appeared after an action, and what went away", async () => {
    await page(`<button aria-label="Toggle panel" aria-expanded="false">Show Panel</button><div id="panel" style="display: none">The panel's content</div>`);
    const toggle = document.querySelector("button")!;
    const panel = document.querySelector<HTMLElement>("#panel")!;
    toggle.addEventListener("click", () => {
      const open = panel.style.display === "none";
      panel.style.display = open ? "block" : "none";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Hide Panel" : "Show Panel";
    });
    const { planner, requests } = scripted((request, step) =>
      step < 2 ? { type: "click", target: idOf(request, "Toggle panel") } : { type: "done", success: true, summary: "ok" });

    await run("Click show panel twice", planner);

    assert.equal(requests[1]?.history[0]?.note, `now it shows "Hide Panel" and is expanded; appeared: text "The panel's content"`);
    assert.match(requests[2]?.history[1]?.note ?? "", /went away: text "The panel's content"$/);
  });

  test("an action with no reply is a step the planner hears about, not the end of the task", async () => {
    await page(`<button>Go</button>`);
    let dropped = false;
    const flaky: PageLink = {
      ...link,
      // The page unloads mid-click, so the click's reply never comes.
      send: async (message) => {
        if (message.type === "action.execute" && !dropped) {
          dropped = true;
          return undefined;
        }
        return link.send(message);
      },
    };
    const { planner, requests } = scripted((request, step) =>
      step === 0 ? { type: "click", target: idOf(request, "Go") } : { type: "done", success: true, summary: "ok" });
    const events: AgentEvent[] = [];

    await runAgentTask({ goal: "Go", planner, link: flaky, signal: new AbortController().signal, onEvent: (e) => events.push(e) });

    const finished = events.at(-1) as Extract<AgentEvent, { type: "finished" }>;
    assert.equal(finished.outcome, "completed");
    assert.equal(finished.steps, 1);
    assert.equal(requests[1]?.history[0]?.note, "the page did not answer");
  });

  test("reports a planner failure with its message", async () => {
    await page(`<button>Go</button>`);
    const planner: ActionPlanner = async () => { throw new Error("Could not reach the Skrim server"); };

    const { finished } = await run("Go", planner);

    assert.equal(finished.errorCode, "PLANNER_ERROR");
    assert.equal(finished.message, "Could not reach the Skrim server");
  });

  test("stops without sending when the outbound check finds PII", async () => {
    await page(`<button>Go</button>`);
    const planner: ActionPlanner = async (request) => {
      assertOutboundSafe({ ...request, goal: "leaked someone@example.com" });
      throw new Error("unreachable");
    };

    const { finished } = await run("Go", planner);

    assert.equal(finished.errorCode, "PII_TRIPWIRE");
  });

  test("ends as cancelled when the user stops it", async () => {
    await page(`<button>Go</button>`);
    const controller = new AbortController();
    const planner: ActionPlanner = (_request, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
      controller.abort();
    });

    const { finished } = await run("Go", planner, controller.signal);

    assert.equal(finished.outcome, "cancelled");
  });
});
