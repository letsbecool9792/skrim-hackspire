export function shouldCapture(mutationCount: number, timeSinceLastCaptureMs: number): boolean {
  return mutationCount > 0 || timeSinceLastCaptureMs >= 1_000;
}

export function frameSignature(data: Uint8Array): number {
  let hash = 2166136261;
  for (let index = 0; index < data.length; index += 97) {
    hash ^= data[index] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hasFrameChanged(previous: number | null, current: number): boolean {
  return previous === null || previous !== current;
}
