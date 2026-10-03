/**
 * Which tab the agent works on.
 *
 * In a side panel (Chrome) or a sidebar (Firefox on a computer) it is the tab
 * in front of the panel's window. Firefox for Android has no sidebar, so the
 * panel opens as a tab of its own (entrypoints/background) and is told the
 * tab to work on in its address: `sidepanel.html?tab=<id>`. There the tab in
 * front is the panel, never the page.
 */
export const PANEL_TARGET_PARAM = "tab";

/** The tab id the panel was opened for, or undefined when it is a side panel. */
export function panelTargetFromUrl(href: string): number | undefined {
  const raw = new URL(href).searchParams.get(PANEL_TARGET_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

/** True when the panel runs as a tab of its own (Firefox for Android). */
export function panelIsTab(href: string): boolean {
  return panelTargetFromUrl(href) !== undefined;
}
