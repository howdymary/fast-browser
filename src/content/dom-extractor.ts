import type { ElementRef, PageState } from '../shared/types';
import { isSensitiveElement } from '../shared/security';

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="textbox"]',
  '[contenteditable="true"]',
  '[onclick]',
].join(',');

const MAX_VISIBLE_TEXT_CHARS = 1500;
const MAX_INTERACTIVE_ELEMENTS = 40;
export const FAST_BROWSER_REF_ATTR = 'data-fast-browser-ref';

function clearPriorRefs(rootDocument: Document): void {
  for (const element of Array.from(rootDocument.querySelectorAll(`[${FAST_BROWSER_REF_ATTR}]`))) {
    element.removeAttribute(FAST_BROWSER_REF_ATTR);
  }
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (
    style.display === 'none'
    || style.visibility === 'hidden'
    || style.opacity === '0'
    || style.pointerEvents === 'none'
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const withinVerticalReach = rect.bottom >= -window.innerHeight * 2
    && rect.top <= window.innerHeight * 3;
  return rect.width > 0 && rect.height > 0 && withinVerticalReach;
}

function getElementRole(element: Element): string {
  return element.getAttribute('role') ?? element.tagName.toLowerCase();
}

function getLabelFromAriaLabelledBy(element: Element): string {
  const ids = (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return ids
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

function getElementName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  const labelledBy = getLabelFromAriaLabelledBy(element);
  if (labelledBy) {
    return labelledBy;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const label = element.labels?.[0]?.textContent?.trim();
    if (label) {
      return label;
    }
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.placeholder.trim()) {
      return element.placeholder.trim();
    }
    if (element.name?.trim()) {
      return element.name.trim();
    }
  }

  const text = element.textContent?.replace(/\s+/g, ' ').trim();
  if (text) {
    return text.slice(0, 120);
  }

  if (element instanceof HTMLImageElement && element.alt.trim()) {
    return element.alt.trim();
  }

  return element.getAttribute('title')?.trim() ?? '';
}

function getContextLabel(element: Element): string {
  const context = element.closest('form, dialog, section, article, nav, aside, main');
  if (!context) {
    return '';
  }

  const heading = context.querySelector('h1, h2, h3, legend');
  return heading?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '';
}

function getElementState(element: Element): string[] | undefined {
  const states: string[] = [];
  if (element instanceof HTMLInputElement) {
    if (element.disabled) states.push('disabled');
    if (element.checked) states.push('checked');
  }

  if (element instanceof HTMLOptionElement) {
    if (element.selected) states.push('selected');
  }

  if (element.getAttribute('aria-expanded') === 'true') {
    states.push('expanded');
  }

  return states.length > 0 ? states : undefined;
}

function isInViewport(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.bottom >= 0
    && rect.right >= 0
    && rect.top <= window.innerHeight
    && rect.left <= window.innerWidth;
}

function rankInteractiveElement(element: Element): number {
  let score = 0;
  const tag = element.tagName.toLowerCase();
  if (isInViewport(element)) score += 5;
  if (tag === 'button') score += 4;
  if (tag === 'input' || tag === 'textarea' || tag === 'select') score += 3;
  if (tag === 'a') score += 2;
  if (getElementName(element)) score += 3;
  if (element.closest('header, nav, main, form, dialog')) score += 1;
  return score;
}

function shouldIncludeElement(element: Element): boolean {
  const name = getElementName(element);
  if (name) {
    return true;
  }

  const isFocused = document.activeElement === element;
  const hasValue = element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement;

  return isFocused || hasValue;
}

function toElementRef(element: Element, index: number): ElementRef {
  const ref = `@e${index + 1}`;
  element.setAttribute(FAST_BROWSER_REF_ATTR, ref);
  const state = getElementState(element);
  const sensitive = isSensitiveElement(element);
  const value = isSensitiveElement(element)
    ? '[REDACTED]'
    : (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
      ? element.value || undefined
      : undefined);

  return {
    ref,
    tag: element.tagName.toLowerCase(),
    role: getElementRole(element),
    name: getElementName(element) || '(unlabeled element)',
    type: element instanceof HTMLInputElement ? element.type : undefined,
    state,
    value,
    context: getContextLabel(element) || undefined,
    sensitive: sensitive || undefined,
    inViewport: isInViewport(element),
  };
}

function extractVisibleText(root: ParentNode = document): string {
  const blocks = Array.from(root.querySelectorAll('h1, h2, h3, h4, p, li, dt, dd, td, th, figcaption, label'))
    .filter((element) => isVisible(element))
    .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean);
  return blocks.join('\n').slice(0, MAX_VISIBLE_TEXT_CHARS);
}

export function extractPageState(rootDocument: Document = document): PageState {
  clearPriorRefs(rootDocument);
  const snapshotId = crypto.randomUUID();
  rootDocument.documentElement.setAttribute('data-fast-browser-snapshot-id', snapshotId);
  const interactiveElements = Array.from(rootDocument.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((element, index, self) => self.indexOf(element) === index)
    .filter((element) => isVisible(element))
    .filter((element) => shouldIncludeElement(element))
    .sort((a, b) => rankInteractiveElement(b) - rankInteractiveElement(a))
    .slice(0, MAX_INTERACTIVE_ELEMENTS)
    .map((element, index) => toElementRef(element, index));

  const scrollHeight = Math.max(
    rootDocument.documentElement.scrollHeight,
    rootDocument.body?.scrollHeight ?? 0,
    1,
  );
  const scrollTop = rootDocument.documentElement.scrollTop || rootDocument.body?.scrollTop || 0;
  const viewportHeight = window.innerHeight || rootDocument.documentElement.clientHeight || 0;
  const maxScrollable = Math.max(scrollHeight - viewportHeight, 1);

  return {
    snapshotId,
    url: rootDocument.location.href,
    title: rootDocument.title,
    visibleText: extractVisibleText(rootDocument),
    elements: interactiveElements,
    meta: {
      hasForm: rootDocument.querySelector('form') !== null,
      hasDialog: rootDocument.querySelector('dialog, [role="dialog"]') !== null,
      scrollPercent: Math.round((scrollTop / maxScrollable) * 100),
      loadingState: rootDocument.readyState,
      elementCount: interactiveElements.length,
    },
  };
}
