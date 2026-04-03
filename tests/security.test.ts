import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { isSensitiveElement } from '../src/shared/security';

function installDomGlobals(dom: JSDOM): void {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  });
}

function makeDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  installDomGlobals(dom);
  return dom;
}

function createElement(dom: JSDOM, tag: string, attrs: Record<string, string> = {}): Element {
  const element = dom.window.document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
  dom.window.document.body.appendChild(element);
  return element;
}

describe('isSensitiveElement', () => {
  it('returns true for type="password"', () => {
    const dom = makeDom();
    const input = createElement(dom, 'input', { type: 'password' });
    expect(isSensitiveElement(input)).toBe(true);
  });

  it('returns true for autocomplete="cc-number"', () => {
    const dom = makeDom();
    const input = createElement(dom, 'input', { autocomplete: 'cc-number' });
    expect(isSensitiveElement(input)).toBe(true);
  });

  it('returns true for name="cvv"', () => {
    const dom = makeDom();
    const input = createElement(dom, 'input', { name: 'cvv' });
    expect(isSensitiveElement(input)).toBe(true);
  });

  it('returns true for name="card_number"', () => {
    const dom = makeDom();
    const input = createElement(dom, 'input', { name: 'card_number' });
    expect(isSensitiveElement(input)).toBe(true);
  });

  it('returns true for name="ssn"', () => {
    const dom = makeDom();
    const input = createElement(dom, 'input', { name: 'ssn' });
    expect(isSensitiveElement(input)).toBe(true);
  });

  it('returns false for name="username"', () => {
    const dom = makeDom();
    const input = createElement(dom, 'input', { name: 'username' });
    expect(isSensitiveElement(input)).toBe(false);
  });

  it('returns false for name="email"', () => {
    const dom = makeDom();
    const input = createElement(dom, 'input', { name: 'email' });
    expect(isSensitiveElement(input)).toBe(false);
  });

  it('returns false for a regular text input with no sensitive attributes', () => {
    const dom = makeDom();
    const input = createElement(dom, 'input', { type: 'text' });
    expect(isSensitiveElement(input)).toBe(false);
  });

  it('returns false for a non-input element (div)', () => {
    const dom = makeDom();
    const div = createElement(dom, 'div');
    expect(isSensitiveElement(div)).toBe(false);
  });
});
