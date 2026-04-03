import type { ClickAction, ExecutableAction, ScrollAction, TypeAction, WaitAction } from '../shared/types';
import { isSensitiveElement } from '../shared/security';

export interface SnapshotCache {
  snapshotId: string;
  elementsByRef: Map<string, HTMLElement>;
}

function assertFreshSnapshot(expectedSnapshotId: string, snapshot: SnapshotCache | null): SnapshotCache {
  if (!snapshot || snapshot.snapshotId !== expectedSnapshotId) {
    throw new Error('The page changed before the action could run. Refresh the snapshot and try again.');
  }
  return snapshot;
}

function getElementByRef(ref: string, snapshot: SnapshotCache): HTMLElement {
  const element = snapshot.elementsByRef.get(ref);
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    throw new Error(`Element ${ref} is no longer available.`);
  }
  return element;
}

function ensureActionableElement(element: HTMLElement): void {
  if ('disabled' in element && Boolean((element as HTMLButtonElement | HTMLInputElement).disabled)) {
    throw new Error('Target element is disabled.');
  }
  if ('readOnly' in element && Boolean((element as HTMLInputElement | HTMLTextAreaElement).readOnly)) {
    throw new Error('Target element is read-only.');
  }
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as {
    value?: string;
  };
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    ?? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

  if (descriptor?.set) {
    descriptor.set.call(element, value);
    return;
  }

  element.value = value;
}

function executeClick(action: ClickAction, snapshot: SnapshotCache): void {
  const element = getElementByRef(action.ref, snapshot);
  ensureActionableElement(element);
  if (isSensitiveElement(element)) {
    throw new Error('Sensitive elements require human approval.');
  }
  element.scrollIntoView({ block: 'center', inline: 'center' });
  element.focus();
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function executeType(action: TypeAction, snapshot: SnapshotCache): void {
  const element = getElementByRef(action.ref, snapshot);
  ensureActionableElement(element);
  if (isSensitiveElement(element)) {
    throw new Error('Sensitive elements require human approval.');
  }
  element.scrollIntoView({ block: 'center', inline: 'center' });

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus();
    if (typeof element.select === 'function') {
      element.select();
    }
    setNativeValue(element, '');
    for (const char of action.text) {
      setNativeValue(element, `${element.value}${char}`);
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: char,
        inputType: 'insertText',
      }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (element.isContentEditable) {
    element.focus();
    element.textContent = action.text;
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: action.text,
      inputType: 'insertText',
    }));
    return;
  }

  throw new Error('Target element does not support typing.');
}

async function executeScroll(action: ScrollAction): Promise<void> {
  const scrollingElement = document.scrollingElement ?? document.documentElement;
  const scrollTopBefore = scrollingElement.scrollTop;
  const scrollYBefore = window.scrollY;
  const delta = action.direction === 'down' ? window.innerHeight * 0.8 : -window.innerHeight * 0.8;
  scrollingElement.scrollTop += delta;
  window.scrollBy({ top: delta, behavior: 'auto' });
  await new Promise((resolve) => window.setTimeout(resolve, 50));
  if (scrollingElement.scrollTop === scrollTopBefore && window.scrollY === scrollYBefore) {
    throw new Error(`Scroll ${action.direction} had no effect.`);
  }
}

async function executeWait(action: WaitAction): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, Math.max(50, action.ms)));
}

export async function executeAction(
  action: ExecutableAction,
  snapshotId: string,
  snapshot: SnapshotCache | null,
): Promise<void> {
  const currentSnapshot = assertFreshSnapshot(snapshotId, snapshot);

  switch (action.action) {
    case 'click':
      executeClick(action, currentSnapshot);
      return;
    case 'type':
      executeType(action, currentSnapshot);
      return;
    case 'scroll':
      await executeScroll(action);
      return;
    case 'wait':
      await executeWait(action);
      return;
    default:
      throw new Error(`Unsupported content action ${(action as ExecutableAction).action}`);
  }
}
