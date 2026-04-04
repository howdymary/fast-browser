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

  it('recovers from a page reload or rerender during an action by refreshing and replanning', async () => {
    const firstPage = makePageState({
      snapshotId: 'snapshot-1',
      url: 'https://example.com/start',
      visibleText: 'Start page',
      elements: [
        {
          ref: '@e1',
          tag: 'button',
          role: 'button',
          name: 'Open search',
          inViewport: true,
        },
      ],
    });
    const refreshedPage = makePageState({
      snapshotId: 'snapshot-2',
      url: 'https://example.com/search',
      visibleText: 'Search page',
      elements: [],
      meta: {
        hasForm: true,
        hasDialog: false,
        scrollPercent: 0,
        loadingState: 'complete',
        elementCount: 0,
      },
    });
    const warnings: string[] = [];
    const callModel = vi
      .fn()
      .mockResolvedValueOnce('{"action":"click","ref":"@e1","reason":"Open search"}')
      .mockResolvedValueOnce('{"action":"done","result":"Search page is open.","reason":"Task complete"}');

    const result = await runAgentLoop(
      {
        task: 'Open search',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi
          .fn<() => Promise<PageState>>()
          .mockResolvedValueOnce(firstPage)
          .mockResolvedValueOnce(refreshedPage),
        executeAction: vi.fn().mockRejectedValueOnce(new Error('The page reloaded or rerendered before the action could run.')),
        navigate: vi.fn().mockResolvedValue(undefined),
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
    expect(result.pageState?.snapshotId).toBe('snapshot-2');
    expect(warnings.some((message) => /refreshing the snapshot and replanning/i.test(message))).toBe(true);
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

  it('repairs malformed JSON when a property name is not double-quoted', async () => {
    const page = makePageState({
      elements: [],
    });

    const result = await runAgentLoop(
      {
        task: 'What is the title of this page?',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue('{"action":"done","result":"Title: Example",reason:"Got the title"}'),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toContain('Title: Example');
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

  it('unwraps a multi-step actions wrapper and uses the first action only', async () => {
    const firstPage = makePageState();
    const secondPage = makePageState({
      snapshotId: 'snapshot-2',
      visibleText: 'Search opened',
    });
    const warnings: string[] = [];

    const result = await runAgentLoop(
      {
        task: 'Open search',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi
          .fn<() => Promise<PageState>>()
          .mockResolvedValueOnce(firstPage)
          .mockResolvedValueOnce(secondPage)
          .mockResolvedValueOnce(secondPage),
        executeAction: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue(undefined),
        callModel: vi
          .fn()
          .mockResolvedValueOnce('{"actions":[{"action":"click","ref":"@e1","reason":"Open search"},{"action":"type","ref":"@e2","text":"weather","reason":"Fill search"}]}')
          .mockResolvedValueOnce('{"action":"done","result":"Search opened","reason":"Task complete"}'),
        emitEvent: async (event) => {
          if (event.entry?.kind === 'warning') {
            warnings.push(event.entry.message);
          }
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(warnings.some((message) => /multi-step plan/i.test(message))).toBe(true);
  });

  it('unwraps a next_action wrapper from the model response', async () => {
    const page = makePageState();

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
        callModel: vi.fn().mockResolvedValue('{"next_action":{"action":"done","result":"Finished","reason":"Task complete"}}'),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toMatch(/finished/i);
  });

  it('normalizes an array-shaped done result into bullet text', async () => {
    const page = makePageState({
      visibleText: 'Hormuz overview',
      elements: [],
    });

    const result = await runAgentLoop(
      {
        task: 'Summarize this page in 3 bullets.',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue(`{"action":"done","result":["The Strait of Hormuz is a narrow waterway connecting the Persian Gulf to the Gulf of Oman.","It is located between Iran and Oman, and is an important shipping route for oil and liquefied natural gas.","The strait is approximately 21 miles (34 km) wide at its narrowest point."],"reason":"Summarized the page"}`),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toContain('- The Strait of Hormuz is a narrow waterway connecting the Persian Gulf to the Gulf of Oman.');
    expect(result.finalMessage).toContain('- It is located between Iran and Oman, and is an important shipping route for oil and liquefied natural gas.');
  });

  it('normalizes object-shaped done results when the model nests summary text', async () => {
    const page = makePageState({
      elements: [],
    });

    const result = await runAgentLoop(
      {
        task: 'Summarize this page in 3 bullets.',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue('{"action":"done","result":{"summary":"- Point one\\n- Point two\\n- Point three"},"reason":"Summarized the page"}'),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toContain('Point one');
    expect(result.finalMessage).toContain('Point three');
  });

  it('parses fenced JSON read-only results with array bullets', async () => {
    const page = makePageState({
      elements: [],
    });

    const result = await runAgentLoop(
      {
        task: 'Summarize this page in 3 bullets.',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue([
          '```json',
          '{"action":"done","result":["Point one","Point two","Point three"],"reason":"Summarized the page"}',
          '```',
        ].join('\n')),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toContain('- Point one');
    expect(result.finalMessage).toContain('- Point three');
  });

  it('parses done results with nested content arrays', async () => {
    const page = makePageState({
      elements: [],
    });

    const result = await runAgentLoop(
      {
        task: 'Summarize this page in 3 bullets.',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue('{"action":"done","result":{"content":["Point one","Point two","Point three"]},"reason":"Summarized the page"}'),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toContain('- Point one');
    expect(result.finalMessage).toContain('- Point three');
  });

  it('normalizes ask_human questions when the model returns a list', async () => {
    const page = makePageState();

    const result = await runAgentLoop(
      {
        task: 'Do something risky',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue('{"action":"ask_human","question":["I found multiple destructive options.","Which one should I use?"],"reason":"Need confirmation"}'),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toContain('I found multiple destructive options.');
    expect(result.finalMessage).toContain('Which one should I use?');
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

  it('uses a read-only summary prompt for summarize tasks and finishes without actions', async () => {
    const page = makePageState({
      visibleText: 'Fast Browser helps automate browser tasks from natural language.',
      elements: [],
    });
    const callModel = vi.fn().mockResolvedValue('{"action":"done","result":"- Automates browser tasks\\n- Uses natural language\\n- Runs in Chrome","reason":"Summarized page"}');

    const result = await runAgentLoop(
      {
        task: 'Summarize this page in 3 bullets.',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toMatch(/automates browser tasks/i);
    expect(callModel).toHaveBeenCalledWith(
      expect.stringContaining('The user\'s task is read-only. Do not click, type, scroll, wait, or navigate.'),
      expect.any(Array),
      DEFAULT_PROVIDER_SETTINGS,
      expect.anything(),
    );
  });

  it('treats basic page questions as read-only tasks', async () => {
    const page = makePageState({
      title: 'Strait of Hormuz - Wikipedia',
      visibleText: 'The Strait of Hormuz is a narrow waterway.',
      elements: [
        {
          ref: '@e3',
          tag: 'input',
          role: 'searchbox',
          name: 'Search Wikipedia',
          inViewport: true,
        },
      ],
      meta: {
        hasForm: true,
        hasDialog: false,
        scrollPercent: 0,
        loadingState: 'complete',
        elementCount: 1,
      },
    });
    const callModel = vi.fn().mockResolvedValue('{"action":"done","result":"Title: Strait of Hormuz - Wikipedia","reason":"Answered the question"}');

    const result = await runAgentLoop(
      {
        task: 'What is the title of this page?',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toContain('Title: Strait of Hormuz - Wikipedia');
    expect(callModel).toHaveBeenCalledWith(
      expect.stringContaining('The user\'s task is read-only. Do not click, type, scroll, wait, or navigate.'),
      expect.any(Array),
      DEFAULT_PROVIDER_SETTINGS,
      expect.anything(),
    );
  });

  it('handles read-only extraction tasks without taking actions', async () => {
    const page = makePageState({
      title: 'Fast Browser Docs',
      visibleText: 'Fast Browser Docs\nMain heading\nHelpful product notes.',
      elements: [],
    });
    const callModel = vi.fn().mockResolvedValue('{"action":"done","result":"Title: Fast Browser Docs\\nMain heading: Main heading","reason":"Extracted requested details"}');

    const result = await runAgentLoop(
      {
        task: 'Extract the page title and main heading.',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toContain('Title: Fast Browser Docs');
    expect(result.finalMessage).toContain('Main heading: Main heading');
    expect(callModel).toHaveBeenCalledWith(
      expect.stringContaining('The user\'s task is read-only. Do not click, type, scroll, wait, or navigate.'),
      expect.any(Array),
      DEFAULT_PROVIDER_SETTINGS,
      expect.anything(),
    );
  });

  it('completes a search/form workflow by typing, clicking, then finishing', async () => {
    const initialPage = makePageState({
      snapshotId: 'snapshot-1',
      title: 'Search',
      visibleText: 'Search form',
      elements: [
        {
          ref: '@e1',
          tag: 'input',
          role: 'searchbox',
          name: 'Search query',
          value: '',
          context: 'Search',
          inViewport: true,
        },
        {
          ref: '@e2',
          tag: 'button',
          role: 'button',
          name: 'Search',
          context: 'Search',
          inViewport: true,
        },
      ],
      meta: {
        hasForm: true,
        hasDialog: false,
        scrollPercent: 0,
        loadingState: 'complete',
        elementCount: 2,
      },
    });
    const typedPage = makePageState({
      snapshotId: 'snapshot-2',
      title: 'Search',
      visibleText: 'Search form',
      elements: [
        {
          ref: '@e1',
          tag: 'input',
          role: 'searchbox',
          name: 'Search query',
          value: 'weather in sf',
          context: 'Search',
          inViewport: true,
        },
        {
          ref: '@e2',
          tag: 'button',
          role: 'button',
          name: 'Search',
          context: 'Search',
          inViewport: true,
        },
      ],
      meta: {
        hasForm: true,
        hasDialog: false,
        scrollPercent: 0,
        loadingState: 'complete',
        elementCount: 2,
      },
    });
    const resultsPage = makePageState({
      snapshotId: 'snapshot-3',
      title: 'Weather results',
      visibleText: 'Weather results for San Francisco',
      elements: [],
      meta: {
        hasForm: false,
        hasDialog: false,
        scrollPercent: 0,
        loadingState: 'complete',
        elementCount: 0,
      },
    });

    const executeAction = vi.fn().mockResolvedValue(undefined);
    const callModel = vi
      .fn()
      .mockResolvedValueOnce('{"action":"type","ref":"@e1","text":"weather in sf","reason":"Fill the search box"}')
      .mockResolvedValueOnce('{"action":"click","ref":"@e2","reason":"Submit the search"}')
      .mockResolvedValueOnce('{"action":"done","result":"Opened the weather results page.","reason":"Task complete"}');

    const result = await runAgentLoop(
      {
        task: 'Search for weather in sf.',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi
          .fn<() => Promise<PageState>>()
          .mockResolvedValueOnce(initialPage)
          .mockResolvedValueOnce(typedPage)
          .mockResolvedValueOnce(resultsPage),
        executeAction,
        navigate: vi.fn().mockResolvedValue(undefined),
        callModel,
      },
    );

    expect(result.ok).toBe(true);
    expect(executeAction).toHaveBeenNthCalledWith(
      1,
      { action: 'type', ref: '@e1', text: 'weather in sf', reason: 'Fill the search box' },
      'snapshot-1',
    );
    expect(executeAction).toHaveBeenNthCalledWith(
      2,
      { action: 'click', ref: '@e2', reason: 'Submit the search' },
      'snapshot-2',
    );
    expect(result.pageState?.snapshotId).toBe('snapshot-3');
  });

  it('allows ordinary navigation clicks without asking for approval', async () => {
    const firstPage = makePageState({
      snapshotId: 'snapshot-1',
      title: 'Docs home',
      visibleText: 'Docs home',
      elements: [
        {
          ref: '@e1',
          tag: 'a',
          role: 'link',
          name: 'Pricing',
          context: 'Docs',
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
    });
    const secondPage = makePageState({
      snapshotId: 'snapshot-2',
      title: 'Pricing',
      visibleText: 'Pricing page',
      elements: [],
      meta: {
        hasForm: false,
        hasDialog: false,
        scrollPercent: 0,
        loadingState: 'complete',
        elementCount: 0,
      },
    });

    const result = await runAgentLoop(
      {
        task: 'Open the pricing page.',
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
          .mockResolvedValueOnce('{"action":"click","ref":"@e1","reason":"Open pricing"}')
          .mockResolvedValueOnce('{"action":"done","result":"Opened pricing.","reason":"Task complete"}'),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toContain('Opened pricing');
  });

  it('asks for approval before clicking a sign-in button in an auth flow', async () => {
    const page = makePageState({
      title: 'Sign in',
      visibleText: 'Sign in to continue',
      elements: [
        {
          ref: '@e1',
          tag: 'input',
          role: 'textbox',
          name: 'Email',
          context: 'Sign in',
          inViewport: true,
        },
        {
          ref: '@e2',
          tag: 'input',
          role: 'textbox',
          name: 'Password',
          type: 'password',
          context: 'Sign in',
          sensitive: true,
          inViewport: true,
        },
        {
          ref: '@e3',
          tag: 'button',
          role: 'button',
          name: 'Sign in',
          context: 'Sign in',
          inViewport: true,
        },
      ],
      meta: {
        hasForm: true,
        hasDialog: false,
        scrollPercent: 0,
        loadingState: 'complete',
        elementCount: 3,
      },
    });

    const result = await runAgentLoop(
      {
        task: 'Sign in to this site.',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue('{"action":"click","ref":"@e3","reason":"Submit sign in"}'),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toMatch(/needs confirmation|important/i);
    expect(result.feed.some((entry) => entry.kind === 'warning')).toBe(true);
  });

  it('asks for approval before clicking a checkout button in a payment flow', async () => {
    const page = makePageState({
      title: 'Checkout',
      visibleText: 'Checkout page',
      elements: [
        {
          ref: '@e1',
          tag: 'button',
          role: 'button',
          name: 'Place order',
          context: 'Checkout',
          inViewport: true,
        },
      ],
      meta: {
        hasForm: true,
        hasDialog: false,
        scrollPercent: 0,
        loadingState: 'complete',
        elementCount: 1,
      },
    });

    const result = await runAgentLoop(
      {
        task: 'Complete checkout.',
        settings: DEFAULT_PROVIDER_SETTINGS,
      },
      {
        signal: new AbortController().signal,
        getPageState: vi.fn().mockResolvedValue(page),
        executeAction: vi.fn(),
        navigate: vi.fn(),
        callModel: vi.fn().mockResolvedValue('{"action":"click","ref":"@e1","reason":"Place the order"}'),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toMatch(/needs confirmation|important/i);
  });
});
