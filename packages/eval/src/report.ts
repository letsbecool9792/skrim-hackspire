import type { FixtureScore, Totals } from "./score.ts";

/**
 * The results as Markdown: the numbers, then what was missed and what was
 * hidden that should not have been. Failure modes are half the result
 * (packages/eval/CLAUDE.md).
 */

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const ms = (value: number) => `${Math.round(value)} ms`;

export function renderReport(title: string, totals: Totals, scores: FixtureScore[]): string {
  const lines: string[] = [];
  lines.push(`# ${title}`, "");
  lines.push("| Metric | Value |", "|---|---|");
  lines.push(`| Fixtures | ${totals.fixtures} |`);
  lines.push(`| PII items | ${totals.pii} (${totals.seen} in the page's text, ${totals.pii - totals.seen} only in pixels or frames) |`);
  lines.push(`| **Recall, PII in the text** | **${percent(totals.recallInText)}** (${totals.caught} of ${totals.seen} hidden everywhere they appear; ${totals.partial} partly) |`);
  lines.push(`| Recall, all PII | ${percent(totals.recall)} |`);
  lines.push(`| **Precision** | **${percent(totals.precision)}** of hidden spans were PII |`);
  lines.push(`| Right category | ${totals.categoryRight} of ${totals.caught} caught |`);
  lines.push(`| Span IoU, PII in the text | ${totals.iou.toFixed(2)} |`);
  lines.push(`| Near-misses hidden | ${totals.nearMissesHidden} of ${totals.nearMisses} (order numbers, ISBNs, public names: should be 0) |`);
  lines.push(`| Over-redaction | ${percent(totals.overRedaction)} of non-PII characters hidden |`);
  lines.push(`| Median time per page view | observe ${ms(totals.medianMs.observe)}, names ${ms(totals.medianMs.names)}, redact ${ms(totals.medianMs.redact)} |`);
  if (totals.unaligned > 0) lines.push(`| Texts that could not be aligned | ${totals.unaligned} (counted as wholly hidden; a harness bug) |`);
  lines.push("");

  lines.push("## By category", "", "| Category | Caught |", "|---|---|");
  for (const [category, count] of Object.entries(totals.byCategory).sort()) lines.push(`| ${category} | ${count.caught} of ${count.pii} |`);
  lines.push("", "## By where it sits", "", "| Where | Caught |", "|---|---|");
  for (const [where, count] of Object.entries(totals.byLocation)) lines.push(`| ${where} | ${count!.caught} of ${count!.pii} |`);
  lines.push("");

  lines.push("## Per page", "", "| Page | Personal | Caught | False positives | Near-misses hidden | Names ms |", "|---|---|---|---|---|---|");
  for (const score of scores) {
    const caught = score.items.filter((item) => item.caught).length;
    const hiddenMisses = score.nearMisses.filter((miss) => miss.hidden).length;
    const model = score.nameModel === "on" ? "" : ` (model ${score.nameModel})`;
    lines.push(`| ${score.page} | ${score.personal ? "yes" : "no"} | ${caught} of ${score.items.length} | ${score.falsePositives.length} | ${hiddenMisses} of ${score.nearMisses.length} | ${ms(score.timings.namesMs)}${model} |`);
  }
  lines.push("");

  const missed = scores.flatMap((score) => score.items.filter((item) => !item.caught).map((item) => ({ page: score.page, item })));
  if (missed.length > 0) {
    lines.push("## Missed", "");
    for (const { page, item } of missed) {
      const why = !item.seen ? `not in the page's text (${item.item.where})` : item.partial ? "partly hidden" : "readable";
      lines.push(`- ${page}: ${item.item.category} "${item.item.value}": ${why}`);
    }
    lines.push("");
  }
  const falsePositives = scores.flatMap((score) => score.falsePositives.map((fp) => ({ page: score.page, fp })));
  const hiddenMisses = scores.flatMap((score) => score.nearMisses.filter((miss) => miss.hidden).map((miss) => ({ page: score.page, miss })));
  if (falsePositives.length > 0 || hiddenMisses.length > 0) {
    lines.push("## Hidden but not PII", "");
    for (const { page, fp } of falsePositives) lines.push(`- ${page}: "${fp.text}" as ${fp.categories.join("+")}`);
    for (const { page, miss } of hiddenMisses) lines.push(`- ${page}: near-miss "${miss.value}" was hidden`);
    lines.push("");
  }
  const unseenMisses = scores.flatMap((score) => score.nearMisses.filter((miss) => !miss.seen).map((miss) => ({ page: score.page, miss })));
  if (unseenMisses.length > 0) {
    lines.push("## Ground truth not found on the page", "", "Near-misses that appear in no text: fix the annotation or the page.", "");
    for (const { page, miss } of unseenMisses) lines.push(`- ${page}: "${miss.value}"`);
    lines.push("");
  }
  return lines.join("\n");
}
