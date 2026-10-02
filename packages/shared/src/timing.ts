/**
 * Timing instrumentation.
 *
 * 35% of the rubric is resource use and end-to-end latency, and neither is
 * visible unless we measure it deliberately. The dashboard's resource panel
 * reads from here, so anything you want on that panel has to be timed with
 * these helpers rather than an ad-hoc Date.now().
 *
 * Keep the stage names stable - the panel labels come from them.
 */

export type StageName =
  | "capture"
  | "dom.extract"
  | "vision.detect"
  | "pii.regex"
  | "pii.ner"
  | "pii.face"
  | "pii.fuse"
  | "graph.build"
  | "server.roundtrip"
  | "action.execute"
  | "action.verify"
  | "cycle.total";

export interface Sample {
  stage: StageName;
  ms: number;
  at: number;
}

const samples: Sample[] = [];
const MAX_SAMPLES = 500;

export async function timed<T>(stage: StageName, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(stage, performance.now() - start);
  }
}

export function record(stage: StageName, ms: number): void {
  samples.push({ stage, ms, at: Date.now() });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function getSamples(): readonly Sample[] {
  return samples;
}

/** p50 / p95 / count per stage, for the resource panel and the tradeoff slide. */
export function summary(): Record<string, { p50: number; p95: number; n: number }> {
  const byStage = new Map<StageName, number[]>();
  for (const s of samples) {
    const list = byStage.get(s.stage) ?? [];
    list.push(s.ms);
    byStage.set(s.stage, list);
  }

  const out: Record<string, { p50: number; p95: number; n: number }> = {};
  for (const [stage, values] of byStage) {
    values.sort((a, b) => a - b);
    out[stage] = {
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      n: values.length,
    };
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return Math.round((sorted[index] ?? 0) * 100) / 100;
}

export function resetTiming(): void {
  samples.length = 0;
}
