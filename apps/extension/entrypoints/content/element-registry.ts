import { ElementId, BBox } from '@skrim/schema';
import type { ElementId, BBox } from "@skrim/schema";

// Based on standard ARIA roles
export type ElementRole = string;

export interface ElementInfo {
  id: ElementId;
  tagName: string;
  role: ElementRole;
  isVisible: boolean;
  isEnabled: boolean;
  bbox: BBox;
}

export function buildRegistry(): { registry: Map<string, Element>, elements: ElementInfo[] } {
  const registry = new Map<string, Element>();
  const elements: ElementInfo[] = [];

  const nodes = document.querySelectorAll('a, button, input, select, textarea, [role], [tabindex], label, [contenteditable]');
  let counter = 0;

  nodes.forEach((element) => {
    // Check if element is aria-hidden
    if (element.getAttribute('aria-hidden') === 'true') {
      return;
    }

    const rect = element.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 && (element as HTMLElement).offsetParent !== null;

    if (rect.width === 0 || rect.height === 0) {
      return; // Skip zero-size elements
    }

    const isEnabled = !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true';

    const id = `e${counter++}` as ElementId;
    registry.set(id, element);

    let role = element.getAttribute('role');
    const tagName = element.tagName.toLowerCase();
    
    if (!role) {
      if (tagName === 'button') role = 'button';
      else if (tagName === 'a') role = 'link';
      else if (tagName === 'input') {
        const type = element.getAttribute('type');
        if (type === 'text') role = 'textbox';
        else if (type === 'search') role = 'searchbox';
        else if (type === 'checkbox') role = 'checkbox';
        else if (type === 'radio') role = 'radio';
        else role = 'textbox';
      }
      else if (tagName === 'select') role = 'combobox';
      else if (tagName === 'textarea') role = 'textbox';
      else if (tagName === 'img') role = 'image';
      else if (/^h[1-6]$/.test(tagName)) role = 'heading';
      else if (tagName === 'table') role = 'table';
      else if (tagName === 'tr') role = 'row';
      else if (tagName === 'td' || tagName === 'th') role = 'cell';
      else if (tagName === 'ul' || tagName === 'ol') role = 'list';
      else if (tagName === 'li') role = 'listitem';
      else role = 'other';
    }

    elements.push({
      id,
      tagName,
      role,
      isVisible,
      isEnabled,
      bbox: [rect.x, rect.y, rect.width, rect.height]
    });
  });

  return { registry, elements };
}

export function resolveElement(targetId: string, registry: Map<string, Element>): Element | null {
  return registry.get(targetId) || null;
}
