import { describe, expect, it, vi } from 'vitest';

import { runAgentLoop } from '../src/background/agent-loop';
import { DEFAULT_PROVIDER_SETTINGS } from '../src/shared/settings';
import type { PageState } from '../src/shared/types';

function makePageState(overrides: Partial<PageState> = {}): PageState {
  return {
    snapshotId: 'snapshot-1',
    url: 'https://example.com',
    title: 'Example',
    visibleText: 'Example page',
    elements: [
      {
        ref: '@e1',
        tag: 'button',
        role: 'button',
        name: 'Search',
        inViewport: true,
      },
    ],
    meta: {
      hasForm: false,
      hasDialog: false,
      scrollPercent: 0,
      loadingState: 'complete',
      elementCount: 1,
    },
    ...overrides,
  };
}

describe('runAgentLoop', () => {
  it('runs a simple click then done sequence', async () => {
    const firstPage = makePageState();
    const secondPage = makePageState({
      snapshotId: 'snapshot-2',
      visibleText: 'Search results',
    });

    const getPageState = vi
      .fn<() => Promise<PageState>>()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    const executeAction = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    const callModel = vi
      .fn()
      .mockResolvedValueOnce('{"action":"click","ref":"@e1","reason":"Click search"}')
      .mockResolvedValueOnce('{"action":"done","result":"Found the results page.","reason":"Task complete"}');

    const result = await runAgentLoop(
      {
        task: 'Click the search button',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState,
        executeAction,
        navigate,
        callModel,
      },
    );

    expect(result.ok).toBe(true);
    expect(executeAction).toHaveBeenCalledWith(
      { action: 'click', ref: '@e1', reason: 'Click search' },
      'snapshot-1',
    );
    expect(result.finalMessage).toMatch(/results page/i);
    expect(result.pageState?.snapshotId).toBe('snapshot-2');
  });

  it('emits streaming updates in phase order', async () => {
    const firstPage = makePageState();
    const secondPage = makePageState({
      snapshotId: 'snapshot-2',
      visibleText: 'Search results',
      elements: [],
    });
    const phases: string[] = [];

    await runAgentLoop(
      {
        task: 'Click the search button',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi
          .fn<() => Promise<PageState>>()
          .mockResolvedValueOnce(firstPage)
          .mockResolvedValueOnce(secondPage),
        executeAction: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue(undefined),
        callModel: vi
          .fn()
          .mockResolvedValueOnce('{"action":"click","ref":"@e1","reason":"Click search"}')
          .mockResolvedValueOnce('{"action":"done","result":"Found the results page.","reason":"Task complete"}'),
        emitEvent: async (event) => {
          phases.push(event.phase);
        },
      },
    );

    expect(phases).toEqual([
      'observe',
      'observe',
      'plan',
      'plan',
      'act',
      'act',
      'verify',
      'plan',
      'plan',
      'done',
    ]);
  });

  it('warns when a click appears to have no effect', async () => {
    const page = makePageState();
    const warningKinds: Array<string> = [];

    const result = await runAgentLoop(
      {
        task: 'Click the search button',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi
          .fn<() => Promise<PageState>>()
          .mockResolvedValueOnce(page)
          .mockResolvedValueOnce(page),
        executeAction: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue(undefined),
        callModel: vi
          .fn()
          .mockResolvedValueOnce('{"action":"click","ref":"@e1","reason":"Click search"}')
          .mockResolvedValueOnce('{"action":"done","result":"Found the results page.","reason":"Task complete"}'),
        emitEvent: async (event) => {
          if (event.entry?.kind === 'warning') {
            warningKinds.push(event.phase);
          }
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(warningKinds).toContain('verify');
  });

  it('asks for approval before acting on a sensitive field', async () => {
    const page = makePageState({
      elements: [
        {
          ref: '@e1',
          tag: 'input',
          role: 'textbox',
          name: 'Card number',
          sensitive: true,
          inViewport: true,
        },
      ],
    });

    const result = await runAgentLoop(
      {
        task: 'Type the card number',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue('{"action":"type","ref":"@e1","text":"4111","reason":"Fill the field"}'),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toMatch(/sensitive/i);
    expect(result.feed.some((entry) => entry.kind === 'warning')).toBe(true);
  });

  it('stops cleanly when the run is cancelled', async () => {
    const phases: string[] = [];
    const controller = new AbortController();
    controller.abort(new DOMException('Run cancelled.', 'AbortError'));

    const result = await runAgentLoop(
      {
        task: 'Click the search button',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: controller.signal,
        getPageState: vi.fn().mockResolvedValue(makePageState()),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn(),
        emitEvent: async (event) => {
          phases.push(event.phase);
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cancelled/i);
    expect(phases).toEqual([]);
  });

  it('produces an error when the model returns invalid (non-JSON) text', async () => {
    const page = makePageState();

    const result = await runAgentLoop(
      {
        task: 'Click the search button',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue('I am not sure what to do next.'),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('produces an error when the model returns an unknown action type', async () => {
    const page = makePageState();

    const result = await runAgentLoop(
      {
        task: 'Click the search button',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue('{"action":"fly","destination":"moon","reason":"Testing"}'),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unsupported|malformed/i);
  });

  it('does not retry non-transient model failures', async () => {
    const page = makePageState({
      elements: [],
    });
    const callModel = vi.fn().mockRejectedValueOnce(new Error('Model payload rejected'));

    await expect(
      runAgentLoop(
        {
          task: 'Finish the task',
          settings: DEFAULT_PROVIDER_SETTINGS,
        },
        {
          signal: new AbortController().signal,
          getPageState: vi.fn().mockResolvedValue(page),
          executeAction: vi.fn(),
          navigate: vi.fn(),
          callModel,
        },
      ),
    ).rejects.toThrow(/model payload rejected/i);
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it('retries once on a transient model failure', async () => {
    const page = makePageState();
    const warnings: string[] = [];
    const callModel = vi
      .fn()
      .mockRejectedValueOnce(new Error('ollama: Rate limited — wait and retry'))
      .mockResolvedValueOnce('{"action":"done","result":"Recovered","reason":"Task complete"}');

    const result = await runAgentLoop(
      {
        task: 'Finish the task',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel,
        emitEvent: async (event) => {
          if (event.entry?.kind === 'warning') {
            warnings.push(event.entry.message);
          }
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(warnings.some((message) => /retrying/i.test(message))).toBe(true);
  });

  it('accumulates history and refreshes the page after navigation', async () => {
    const firstPage = makePageState({
      snapshotId: 'snapshot-1',
      url: 'https://example.com/start',
      visibleText: 'Start page',
    });
    const secondPage = makePageState({
      snapshotId: 'snapshot-2',
      url: 'https://example.com/next',
      visibleText: 'Next page',
    });
    const prompts: string[] = [];
    const navigate = vi.fn().mockResolvedValue(undefined);
    const callModel = vi
      .fn()
      .mockImplementationOnce(async (_systemPrompt, messages) => {
        prompts.push(messages[0]?.content ?? '');
        return '{"action":"navigate","url":"https://example.com/next","reason":"Open next page"}';
      })
      .mockImplementationOnce(async (_systemPrompt, messages) => {
        prompts.push(messages[0]?.content ?? '');
        return '{"action":"done","result":"Finished","reason":"Task complete"}';
      });

    const result = await runAgentLoop(
      {
        task: 'Open the next page',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi
          .fn<() => Promise<PageState>>()
          .mockResolvedValueOnce(firstPage)
          .mockResolvedValueOnce(secondPage),
        executeAction: vi.fn(),
        navigate,
        callModel,
      },
    );

    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'navigate',
        url: 'https://example.com/next',
      }),
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('History:');
    expect(prompts[1]).toContain('"action":"navigate"');
    expect(prompts[1]).toContain('Next page');
    expect(result.pageState?.snapshotId).toBe('snapshot-2');
  });

  it('honors a smaller max step limit', async () => {
    const page = makePageState({
      elements: [],
    });

    const result = await runAgentLoop(
      {
        task: 'Keep going',
        settings: DEFAULT_PROVIDER_SETTINGS,
        maxSteps: 1,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue(undefined),
        callModel: vi.fn().mockResolvedValue('{"action":"click","ref":"@e1","reason":"Click search"}'),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Stopped after 1 steps/i);
  });
});
