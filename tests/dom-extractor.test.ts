import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractPageState } from '../src/content/dom-extractor';

const RECT = {
  width: 100,
  height: 30,
  top: 10,
  left: 10,
  right: 110,
  bottom: 40,
  x: 10,
  y: 10,
  toJSON: () => ({}),
};

function installDomGlobals(dom: JSDOM): void {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    HTMLImageElement: dom.window.HTMLImageElement,
    HTMLOptionElement: dom.window.HTMLOptionElement,
  });
}

function stubRects(dom: JSDOM): void {
  for (const element of Array.from(dom.window.document.querySelectorAll('*'))) {
    if (element instanceof dom.window.HTMLElement) {
      Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => RECT,
      });
    }
  }
}

describe('extractPageState', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('captures visible text and interactive elements', () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <head><title>Example</title></head>
        <body>
          <main>
            <h1>Search flights</h1>
            <p>Find the cheapest flights without leaving your browser.</p>
            <label for="origin">Origin</label>
            <input id="origin" type="text" placeholder="SFO" />
            <button>Search</button>
            <a href="https://example.com/prices">View prices</a>
          </main>
        </body>
      </html>
    `, { url: 'https://example.com/flights' });

    Object.defineProperty(dom.window, 'innerHeight', { value: 900, configurable: true });
    Object.defineProperty(dom.window, 'innerWidth', { value: 1200, configurable: true });
    stubRects(dom);
    installDomGlobals(dom);

    const pageState = extractPageState(dom.window.document);

    expect(pageState.title).toBe('Example');
    expect(pageState.url).toBe('https://example.com/flights');
    expect(pageState.visibleText).toContain('Search flights');
    expect(pageState.meta.elementCount).toBe(3);
    expect(pageState.elements[0]?.name).toBe('Search');
    expect(pageState.elements.some((element) => element.name === 'Origin')).toBe(true);
  });

  it('redacts sensitive field values', () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <label for="cardNumber">Card number</label>
          <input id="cardNumber" name="card_number" value="4111111111111111" />
        </body>
      </html>
    `, { url: 'https://example.com/checkout' });

    Object.defineProperty(dom.window, 'innerHeight', { value: 900, configurable: true });
    Object.defineProperty(dom.window, 'innerWidth', { value: 1200, configurable: true });
    stubRects(dom);
    installDomGlobals(dom);

    const pageState = extractPageState(dom.window.document);
    expect(pageState.elements[0]?.value).toBe('[REDACTED]');
  });
});
