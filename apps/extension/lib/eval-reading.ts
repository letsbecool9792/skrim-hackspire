import type { Reading } from "@skrim/eval/reading";

import type { PageReading } from "./agent/read-page.ts";

/**
 * A page reading in the eval harness's terms (packages/eval), raw text
 * included. Only the eval build's hook and the Node eval check call this, and
 * only on the synthetic fixture pages.
 */
export function toEvalReading(reading: PageReading, nameModel: Reading["nameModel"]): Reading {
  const { observation, page } = reading;
  const texts = (element: { label?: string; value?: string; hint?: string }) => ({ label: element.label, value: element.value, hint: element.hint });
  return {
    raw: { title: observation.title ?? "", elements: (observation.elements ?? []).map(texts) },
    redacted: { title: page.graph.title, elements: page.graph.elements.map(texts) },
    personal: reading.personal,
    beyondView: observation.beyondView ?? { above: 0, below: 0 },
    timings: reading.timings,
    nameModel,
    faces: reading.faces,
  };
}
