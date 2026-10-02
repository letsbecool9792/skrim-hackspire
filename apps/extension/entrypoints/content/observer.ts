import { log } from '@skrim/shared';

let versionCounter = 0;
let observer: MutationObserver | null = null;
let mutatedSinceAction = false;

export function initObserver(): void {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    let meaningful = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        meaningful = true;
        break;
      }
      if (mutation.type === 'attributes') {
        const target = mutation.target as HTMLElement;
        const tagName = target.tagName?.toLowerCase();
        // Check if it's an interactive element
        if (['a', 'button', 'input', 'select', 'textarea'].includes(tagName) || target.hasAttribute('role') || target.hasAttribute('tabindex')) {
          meaningful = true;
          break;
        }
      }
    }

    if (meaningful) {
      versionCounter++;
      mutatedSinceAction = true;
      log.debug('observer.mutations', { count: mutations.length });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'disabled', 'aria-expanded', 'aria-checked', 'aria-selected', 'value', 'checked', 'hidden']
  });
}

export function getObservationVersion(): number {
  return versionCounter;
}

export function hasMutatedSince(version: number): boolean {
  return versionCounter > version;
}

export function resetMutationFlag(): void {
  mutatedSinceAction = false;
}
