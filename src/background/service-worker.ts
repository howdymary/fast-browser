import type {
  BackgroundMessage,
  BackgroundResponse,
  ContentExecuteRequest,
  ContentExecuteResponse,
  ContentExtractRequest,
  ContentExtractResponse,
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

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
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

      const result = await runAgentLoop(
        {
          task: message.task,
          settings: settings ?? DEFAULT_PROVIDER_SETTINGS,
        },
        {
          getPageState: () => extractActivePageState(tabId, message.task),
          executeAction: async (action, snapshotId) => {
            await executeContentAction(tabId, action, snapshotId);
            await new Promise((resolve) => globalThis.setTimeout(resolve, action.action === 'click' ? 500 : 150));
          },
          navigate: async (action) => {
            await navigateTab(tabId, action);
          },
          callModel: callLlm,
        },
      );

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
