import type {
  BackgroundMessage,
  BackgroundResponse,
  ContentExecuteRequest,
  ContentExecuteResponse,
  ContentExtractRequest,
  ContentExtractResponse,
  RunPortMessage,
  RunStreamUpdate,
  RunTaskPortRequest,
} from '../shared/messages';
import { callLlm } from './llm-client';
import { runAgentLoop } from './agent-loop';
import {
  DEFAULT_PROVIDER_SETTINGS,
  mergeProviderSettings,
  PROVIDER_SETTINGS_STORAGE_KEY,
  validateProviderSettings,
} from '../shared/settings';
import type { ActionFeedEntry, ExecutableAction, NavigateAction, ProviderSettings } from '../shared/types';

const RUNNER_PORT_NAME = 'fast-browser-runner';

function makeFeedEntry(message: string, kind: ActionFeedEntry['kind'] = 'info'): ActionFeedEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    message,
    timestamp: new Date().toISOString(),
  };
}

async function getActiveTabId(): Promise<number> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error('No active tab is available.');
  }
  return activeTab.id;
}

async function loadProviderSettings(): Promise<ProviderSettings> {
  const stored = await chrome.storage.local.get(PROVIDER_SETTINGS_STORAGE_KEY);
  return mergeProviderSettings(stored[PROVIDER_SETTINGS_STORAGE_KEY] as Partial<ProviderSettings> | undefined);
}

async function extractActivePageState(tabId: number, task?: string) {
  const request: ContentExtractRequest = {
    type: 'FAST_BROWSER_EXTRACT_PAGE_STATE',
    task,
  };
  const response = await chrome.tabs.sendMessage(tabId, request) as ContentExtractResponse;
  if (!response.ok || !response.pageState) {
    throw new Error(response.error ?? 'The content script did not return a page snapshot.');
  }
  return response.pageState;
}

async function executeContentAction(tabId: number, action: ExecutableAction, snapshotId: string): Promise<void> {
  const request: ContentExecuteRequest = {
    type: 'FAST_BROWSER_EXECUTE_ACTION',
    action,
    snapshotId,
  };
  const response = await chrome.tabs.sendMessage(tabId, request) as ContentExecuteResponse;
  if (!response.ok) {
    throw new Error(response.error ?? 'The content script could not execute the action.');
  }
}

async function navigateTab(tabId: number, action: NavigateAction): Promise<void> {
  await chrome.tabs.update(tabId, { url: action.url });
  await new Promise<void>((resolve) => {
    const timeoutId = globalThis.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdate);
      resolve();
    }, 4000);

    function handleUpdate(
      updatedTabId: number,
      changeInfo: { status?: string },
      _tab: chrome.tabs.Tab,
    ): void {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        globalThis.clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(handleUpdate);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(handleUpdate);
  });
}

interface RunTaskOptions {
  tabId: number;
  task: string;
  settings: ProviderSettings;
  emitUpdate?: (update: Omit<RunStreamUpdate, 'type' | 'runId'>) => Promise<void> | void;
  isCancelled?: () => boolean;
}

async function runTask(options: RunTaskOptions): Promise<BackgroundResponse> {
  return runAgentLoop(
    {
      task: options.task,
      settings: options.settings ?? DEFAULT_PROVIDER_SETTINGS,
    },
    {
      getPageState: () => extractActivePageState(options.tabId, options.task),
      executeAction: async (action, snapshotId) => {
        await executeContentAction(options.tabId, action, snapshotId);
        await new Promise((resolve) => globalThis.setTimeout(resolve, action.action === 'click' ? 500 : 150));
      },
      navigate: async (action) => {
        await navigateTab(options.tabId, action);
      },
      callModel: callLlm,
      emitUpdate: options.emitUpdate,
      isCancelled: options.isCancelled,
    },
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== RUNNER_PORT_NAME) {
    return;
  }

  let disconnected = false;
  let activeRunId: string | null = null;

  port.onDisconnect.addListener(() => {
    disconnected = true;
  });

  port.onMessage.addListener((message: RunPortMessage | RunTaskPortRequest) => {
    if (message.type !== 'FAST_BROWSER_RUN_START') {
      return;
    }

    if (activeRunId) {
      port.postMessage({
        type: 'FAST_BROWSER_RUN_UPDATE',
        runId: activeRunId,
        step: 0,
        phase: 'error',
        status: 'error',
        feed: [makeFeedEntry('A run is already active on this port.', 'error')],
        error: 'A run is already active on this port.',
        ok: false,
      } satisfies RunStreamUpdate);
      return;
    }

    activeRunId = crypto.randomUUID();

    void (async () => {
      try {
        const tabId = await getActiveTabId();
        const settings = await loadProviderSettings();
        const settingsError = validateProviderSettings(settings);
        if (settingsError) {
          if (!disconnected) {
            port.postMessage({
              type: 'FAST_BROWSER_RUN_UPDATE',
              runId: activeRunId!,
              step: 0,
              phase: 'error',
              status: 'error',
              feed: [makeFeedEntry(settingsError, 'error')],
              error: settingsError,
              ok: false,
            } satisfies RunStreamUpdate);
          }
          return;
        }

        const result = await runTask({
          tabId,
          task: message.task,
          settings,
          emitUpdate: async (update) => {
            if (disconnected) {
              return;
            }
            port.postMessage({
              type: 'FAST_BROWSER_RUN_UPDATE',
              runId: activeRunId!,
              ...update,
            } satisfies RunStreamUpdate);
          },
          isCancelled: () => disconnected,
        });

        if (!disconnected && result.feed.length === 0) {
          port.postMessage({
            type: 'FAST_BROWSER_RUN_UPDATE',
            runId: activeRunId!,
            step: 0,
            phase: result.ok ? 'done' : 'error',
            status: result.ok ? 'idle' : 'error',
            pageState: result.pageState,
            finalMessage: result.finalMessage,
            error: result.error,
            ok: result.ok,
          } satisfies RunStreamUpdate);
        }
      } catch (error) {
        if (!disconnected) {
          port.postMessage({
            type: 'FAST_BROWSER_RUN_UPDATE',
            runId: activeRunId!,
            step: 0,
            phase: 'error',
            status: 'error',
            feed: [makeFeedEntry('Unable to run the browser agent.', 'error')],
            error: error instanceof Error ? error.message : 'Unknown extension error.',
            ok: false,
          } satisfies RunStreamUpdate);
        }
      } finally {
        activeRunId = null;
      }
    })();
  });
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  void (async () => {
    try {
      const tabId = await getActiveTabId();
      if (message.type === 'FAST_BROWSER_INSPECT_PAGE') {
        const pageState = await extractActivePageState(tabId, message.task);
        sendResponse({
          ok: true,
          pageState,
          feed: [
            makeFeedEntry('Connected to the active tab.', 'success'),
            makeFeedEntry(`Captured ${pageState.meta.elementCount} interactive elements.`),
          ],
        } satisfies BackgroundResponse);
        return;
      }

      if (message.type !== 'FAST_BROWSER_RUN_TASK') {
        sendResponse({
          ok: false,
          feed: [makeFeedEntry('Unknown background message.', 'error')],
          error: 'Unknown background message.',
        } satisfies BackgroundResponse);
        return;
      }

      const settings = await loadProviderSettings();
      const settingsError = validateProviderSettings(settings);
      if (settingsError) {
        sendResponse({
          ok: false,
          feed: [makeFeedEntry(settingsError, 'error')],
          error: settingsError,
        } satisfies BackgroundResponse);
        return;
      }

      const result = await runTask({
        tabId,
        task: message.task,
        settings: settings ?? DEFAULT_PROVIDER_SETTINGS,
      });

      sendResponse({
        ...result,
        feed: result.feed.length > 0 ? result.feed : [makeFeedEntry('The loop returned no feed entries.')],
      } satisfies BackgroundResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown extension error.',
        feed: [makeFeedEntry('Unable to run the browser agent.', 'error')],
      } satisfies BackgroundResponse);
    }
  })();

  return true;
});
