import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeAction, type SnapshotCache } from '../src/content/action-executor';

function installDomGlobals(dom: JSDOM): void {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
    InputEvent: dom.window.InputEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
  });

  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => {},
    });
  }
}

function makeSnapshot(snapshotId: string, entries: Array<[string, HTMLElement]>): SnapshotCache {
  return {
    snapshotId,
    elementsByRef: new Map(entries),
  };
}

describe('executeAction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicks a referenced element when the snapshot is fresh', async () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <button id="search">Search</button>
        </body>
      </html>
    `);
    installDomGlobals(dom);

    const button = dom.window.document.getElementById('search') as HTMLElement;
    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    await executeAction(
      { action: 'click', ref: '@e1', reason: 'Click search' },
      'snapshot-1',
      makeSnapshot('snapshot-1', [['@e1', button]]),
    );

    expect(clicked).toBe(true);
  });

  it('rejects stale snapshots instead of guessing', async () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <button id="search">Search</button>
        </body>
      </html>
    `);
    installDomGlobals(dom);

    const button = dom.window.document.getElementById('search') as HTMLElement;

    await expect(
      executeAction(
        { action: 'click', ref: '@e1', reason: 'Click search' },
        'snapshot-2',
        makeSnapshot('snapshot-1', [['@e1', button]]),
      ),
    ).rejects.toThrow(/page reloaded|page changed/i);
  });

  it('blocks typing into sensitive fields', async () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <input id="card" name="card_number" />
        </body>
      </html>
    `);
    installDomGlobals(dom);

    const input = dom.window.document.getElementById('card') as HTMLElement;

    await expect(
      executeAction(
        { action: 'type', ref: '@e1', text: '4111111111111111', reason: 'Fill card' },
        'snapshot-1',
        makeSnapshot('snapshot-1', [['@e1', input]]),
      ),
    ).rejects.toThrow(/sensitive/i);
  });

  it('types into a standard input field', async () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <input id="query" value="" />
        </body>
      </html>
    `);
    installDomGlobals(dom);

    const input = dom.window.document.getElementById('query') as HTMLInputElement;
    let inputEvents = 0;
    let changeEvents = 0;
    input.addEventListener('input', () => {
      inputEvents += 1;
    });
    input.addEventListener('change', () => {
      changeEvents += 1;
    });

    await executeAction(
      { action: 'type', ref: '@e1', text: 'fast browser', reason: 'Fill search' },
      'snapshot-1',
      makeSnapshot('snapshot-1', [['@e1', input]]),
    );

    expect(input.value).toBe('fast browser');
    expect(inputEvents).toBe('fast browser'.length);
    expect(changeEvents).toBe(1);
  });

  it('types into a contenteditable element', async () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <div id="editor"></div>
        </body>
      </html>
    `);
    installDomGlobals(dom);

    const editor = dom.window.document.getElementById('editor') as HTMLElement;
    Object.defineProperty(editor, 'isContentEditable', {
      configurable: true,
      value: true,
    });

    await executeAction(
      { action: 'type', ref: '@e1', text: 'draft note', reason: 'Edit text' },
      'snapshot-1',
      makeSnapshot('snapshot-1', [['@e1', editor]]),
    );

    expect(editor.textContent).toBe('draft note');
  });

  it('types into a nested input when the referenced element is a combobox wrapper', async () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <div id="combo" role="combobox">
            <input id="combo-input" value="" />
          </div>
        </body>
      </html>
    `);
    installDomGlobals(dom);

    const wrapper = dom.window.document.getElementById('combo') as HTMLElement;
    const input = dom.window.document.getElementById('combo-input') as HTMLInputElement;

    await executeAction(
      { action: 'type', ref: '@e1', text: 'weather', reason: 'Fill search' },
      'snapshot-1',
      makeSnapshot('snapshot-1', [['@e1', wrapper]]),
    );

    expect(input.value).toBe('weather');
  });

  it('rejects clicks on disabled targets', async () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <button id="submit" disabled>Submit</button>
        </body>
      </html>
    `);
    installDomGlobals(dom);

    const button = dom.window.document.getElementById('submit') as HTMLElement;

    await expect(
      executeAction(
        { action: 'click', ref: '@e1', reason: 'Click submit' },
        'snapshot-1',
        makeSnapshot('snapshot-1', [['@e1', button]]),
      ),
    ).rejects.toThrow(/disabled/i);
  });

  it('throws when the referenced element is disconnected', async () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <button id="search">Search</button>
        </body>
      </html>
    `);
    installDomGlobals(dom);

    const button = dom.window.document.getElementById('search') as HTMLElement;
    button.remove();

    await expect(
      executeAction(
        { action: 'click', ref: '@e1', reason: 'Click search' },
        'snapshot-1',
        makeSnapshot('snapshot-1', [['@e1', button]]),
      ),
    ).rejects.toThrow(/no longer available/i);
  });

  it('scrolls the window and records movement', async () => {
    const dom = new JSDOM('<!doctype html><html><body style="height: 4000px"></body></html>');
    installDomGlobals(dom);
    Object.defineProperty(dom.window, 'innerHeight', { value: 1000, configurable: true });
    let scrollPosition = 0;
    Object.defineProperty(dom.window, 'scrollY', {
      configurable: true,
      get: () => scrollPosition,
      set: (value: number) => {
        scrollPosition = value;
      },
    });
    const scrollBy = vi.fn((options: ScrollToOptions) => {
      scrollPosition += Number(options.top ?? 0);
    });
    Object.defineProperty(dom.window, 'scrollBy', {
      configurable: true,
      value: scrollBy,
    });

    await executeAction(
      { action: 'scroll', direction: 'down', reason: 'See more' },
      'snapshot-1',
      makeSnapshot('snapshot-1', []),
    );

    expect(scrollBy).toHaveBeenCalled();
    expect(dom.window.scrollY).toBeGreaterThan(0);
  });

  it('enforces a 50ms minimum wait', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    installDomGlobals(dom);
    let observedDelay = 0;
    const setTimeoutSpy = vi
      .spyOn(dom.window, 'setTimeout')
      .mockImplementation(((handler: TimerHandler, timeout?: number) => {
        observedDelay = Number(timeout ?? 0);
        if (typeof handler === 'function') {
          handler();
        }
        return 1 as unknown as number;
      }) as typeof dom.window.setTimeout);

    await executeAction(
      { action: 'wait', ms: 5, reason: 'Pause briefly' },
      'snapshot-1',
      makeSnapshot('snapshot-1', []),
    );

    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(observedDelay).toBe(50);
  });
});
