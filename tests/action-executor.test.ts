import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

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
    ).rejects.toThrow(/page changed/i);
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
});

