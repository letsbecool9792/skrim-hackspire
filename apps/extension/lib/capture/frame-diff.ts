/**
 * Determines if a new screenshot should be captured based on mutation count and time elapsed.
 * 
 * Phase 2: We will implement pixel-diff gating here. 
 * The planned approach is to compare the current frame hash to the previous one,
 * and skip capturing if the pixel difference is below a certain threshold.
 * This ensures that minor UI changes like caret blinks, clock ticks, 
 * or animated banners do not trigger unnecessary model runs.
 * 
 * @param mutationCount Number of DOM mutations since last check
 * @param timeSinceLastCaptureMs Time elapsed since the last screenshot was captured
 * @returns boolean indicating whether a capture is needed
 */
export function shouldCapture(mutationCount: number, timeSinceLastCaptureMs: number): boolean {
  return true;
}
