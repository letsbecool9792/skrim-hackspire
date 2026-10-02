export interface DomObserverOptions {
  onChange: (mutationCount: number) => void;
}

/**
 * Watches the page for DOM changes and coalesces mutations that happen
 * within the same event-loop turn into a single notification.
 *
 * This layer only reports that the DOM changed. It does not rebuild the
 * screen graph or invoke vision.
 */
export function observeDom(
  options: DomObserverOptions,
): MutationObserver {
  let pendingMutationCount = 0;
  let notificationScheduled = false;

  const observer = new MutationObserver((mutations) => {
    pendingMutationCount += mutations.length;

    if (notificationScheduled) {
      return;
    }

    notificationScheduled = true;

    queueMicrotask(() => {
      notificationScheduled = false;

      const mutationCount = pendingMutationCount;
      pendingMutationCount = 0;

      if (mutationCount > 0) {
        options.onChange(mutationCount);
      }
    });
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  return observer;
}
