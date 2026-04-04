import type {
  ClickAction,
  ExecutableAction,
  FocusAction,
  PressAction,
  ScrollAction,
  SelectAction,
  TypeAction,
  WaitAction,
} from '../shared/types';
import { isSensitiveElement } from '../shared/security';

export interface SnapshotCache {
  snapshotId: string;
  elementsByRef: Map<string, HTMLElement>;
}

function assertFreshSnapshot(expectedSnapshotId: string, snapshot: SnapshotCache | null): SnapshotCache {
  if (!snapshot || snapshot.snapshotId !== expectedSnapshotId) {
    throw new Error('The page reloaded or rerendered before the action could run.');
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

type ValueWritableElement = HTMLElement & {
  value: string;
  select?: () => void;
};

function hasWritableValue(element: HTMLElement): element is ValueWritableElement {
  return 'value' in element && typeof (element as { value?: unknown }).value === 'string';
}

function supportsContentEditable(element: HTMLElement): boolean {
  return element.isContentEditable || element.getAttribute('contenteditable') === 'true';
}

function resolveFocusableTarget(element: HTMLElement): HTMLElement {
  if (
    element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || supportsContentEditable(element)
    || hasWritableValue(element)
    || element.tabIndex >= 0
  ) {
    return element;
  }

  const nestedTarget = element.querySelector(
    'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"], button, a[href], [tabindex]',
  );
  if (nestedTarget instanceof HTMLElement) {
    return nestedTarget;
  }

  return element;
}

function resolveTypingTarget(element: HTMLElement): HTMLElement {
  if (
    element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || supportsContentEditable(element)
    || hasWritableValue(element)
  ) {
    return element;
  }

  const nestedTarget = element.querySelector(
    'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]',
  );
  if (nestedTarget instanceof HTMLElement) {
    return nestedTarget;
  }

  return element;
}

function resolveSelectTarget(element: HTMLElement): HTMLElement {
  if (
    element instanceof HTMLSelectElement
    || element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
  ) {
    return element;
  }

  const nestedTarget = element.querySelector('select, [role="combobox"], input:not([type="hidden"]), textarea');
  if (nestedTarget instanceof HTMLElement) {
    return nestedTarget;
  }

  return element;
}

function dispatchKeyboardSequence(element: HTMLElement, char: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
  element.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    data: char,
    inputType: 'insertText',
  }));
}

function finishKeyboardSequence(element: HTMLElement, char: string): void {
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    data: char,
    inputType: 'insertText',
  }));
  element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
}

function setNativeValue(element: ValueWritableElement, value: string): void {
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

function executeFocus(action: FocusAction, snapshot: SnapshotCache): void {
  const referencedElement = getElementByRef(action.ref, snapshot);
  const element = resolveFocusableTarget(referencedElement);
  ensureActionableElement(element);
  element.scrollIntoView({ block: 'center', inline: 'center' });
  element.focus();
}

function executeType(action: TypeAction, snapshot: SnapshotCache): void {
  const referencedElement = getElementByRef(action.ref, snapshot);
  const element = resolveTypingTarget(referencedElement);
  ensureActionableElement(element);
  if (isSensitiveElement(referencedElement) || isSensitiveElement(element)) {
    throw new Error('Sensitive elements require human approval.');
  }
  element.scrollIntoView({ block: 'center', inline: 'center' });

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || hasWritableValue(element)) {
    element.focus();
    if (typeof element.select === 'function') {
      element.select();
    }
    setNativeValue(element, '');
    for (const char of action.text) {
      dispatchKeyboardSequence(element, char);
      setNativeValue(element, `${element.value}${char}`);
      finishKeyboardSequence(element, char);
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (supportsContentEditable(element)) {
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

function tryDispatchKeyboardTargetClick(target: HTMLElement, key: string): void {
  if (key !== 'Enter' && key !== ' ') {
    return;
  }

  if (
    target instanceof HTMLButtonElement
    || target instanceof HTMLAnchorElement
    || target.getAttribute('role') === 'button'
    || target.getAttribute('role') === 'link'
  ) {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }
}

function executePress(action: PressAction, snapshot: SnapshotCache): void {
  const referencedElement = action.ref ? getElementByRef(action.ref, snapshot) : null;
  const fallbackActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const target = referencedElement
    ? resolveFocusableTarget(referencedElement)
    : (fallbackActive ?? document.body);

  ensureActionableElement(target);
  if (referencedElement && (isSensitiveElement(referencedElement) || isSensitiveElement(target))) {
    throw new Error('Sensitive elements require human approval.');
  }

  target.scrollIntoView({ block: 'center', inline: 'center' });
  target.focus();

  const key = action.key;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  if (key.length === 1) {
    target.dispatchEvent(new KeyboardEvent('keypress', { key, bubbles: true, cancelable: true }));
  }

  if (key === 'Enter') {
    const formOwner = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      ? target.form
      : target.closest('form');
    if (formOwner instanceof HTMLFormElement) {
      if (typeof formOwner.requestSubmit === 'function') {
        formOwner.requestSubmit();
      } else {
        formOwner.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    } else {
      tryDispatchKeyboardTargetClick(target, key);
    }
  } else {
    tryDispatchKeyboardTargetClick(target, key);
  }

  target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
}

function executeSelect(action: SelectAction, snapshot: SnapshotCache): void {
  const referencedElement = getElementByRef(action.ref, snapshot);
  const element = resolveSelectTarget(referencedElement);
  ensureActionableElement(element);
  if (isSensitiveElement(referencedElement) || isSensitiveElement(element)) {
    throw new Error('Sensitive elements require human approval.');
  }

  element.scrollIntoView({ block: 'center', inline: 'center' });
  element.focus();

  if (element instanceof HTMLSelectElement) {
    const matchedOption = Array.from(element.options).find((option) => (
      option.value === action.value
      || option.label === action.value
      || option.text === action.value
    ));
    if (!matchedOption) {
      throw new Error(`Could not find option "${action.value}" on the target select.`);
    }
    element.value = matchedOption.value;
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: matchedOption.value,
      inputType: 'insertReplacementText',
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setNativeValue(element, action.value);
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: action.value,
      inputType: 'insertReplacementText',
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  throw new Error('Target element does not support selecting an option.');
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
    case 'focus':
      executeFocus(action, currentSnapshot);
      return;
    case 'press':
      executePress(action, currentSnapshot);
      return;
    case 'select':
      executeSelect(action, currentSnapshot);
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
