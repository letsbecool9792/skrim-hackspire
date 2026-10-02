import { executeAction } from "./actions/dispatcher.ts";
import { describeElement } from "./dom/extract.ts";
import { getScreenGraphProvider } from "./integration.ts";
import type { ActionResultMessage, Message, PageObservationMessage } from "./messages.ts";

/**
 * What the content script does with each message from the side panel, kept
 * out of the entrypoint so tests can drive it against a DOM in memory.
 *
 * Holds the registry from the latest observation: actions address elements by
 * the ids of the graph the planner just saw.
 */
export function createContentHandler(getObservationVersion: () => number) {
  let currentRegistry = new Map<string, Element>();

  return async function handle(message: Message): Promise<PageObservationMessage | ActionResultMessage | undefined> {
    if (message.type === "page.observe") {
      const page = {
        url: window.location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
      const provider = getScreenGraphProvider();
      if (!provider) {
        return { type: "page.observation", taskId: message.taskId, observationVersion: getObservationVersion(), elementCount: 0, hasVisualCapture: false, graphAvailable: false, ...page };
      }
      const result = await provider();
      currentRegistry = result.registry;
      return { type: "page.observation", taskId: message.taskId, observationVersion: getObservationVersion(), elementCount: result.elements.length, hasVisualCapture: result.hasVisualCapture, graphAvailable: true, elements: result.elements, fields: result.fields, ...(result.beyondView ? { beyondView: result.beyondView } : {}), ...page };
    }

    if (message.type === "action.execute") {
      // The side panel has already swapped PII tokens for real values; a type
      // action without typedValue is typed as written (it had no tokens).
      const typedValue = message.typedValue;
      const resolveToken = typedValue === undefined ? undefined : () => typedValue;
      const result = await executeAction(message.action, message.actionId, currentRegistry, getObservationVersion, { resolveToken });
      // What the target shows now ("expanded", "Count: 1") tells the planner
      // more than "the page changed", and is how small models notice they are done.
      const target = "target" in message.action && message.action.target ? currentRegistry.get(message.action.target) : undefined;
      const targetAfter = target?.isConnected ? describeElement(target) : undefined;
      return { type: "action.result", taskId: message.taskId, completed: false, ...result, ...(targetAfter ? { targetAfter } : {}) };
    }

    return undefined;
  };
}
