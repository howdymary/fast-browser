import type {
  BackgroundMessage,
  BackgroundResponse,
  ContentExtractRequest,
  ContentExtractResponse,
} from '../shared/messages';
import type { ActionFeedEntry } from '../shared/types';

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

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  if (message.type !== 'FAST_BROWSER_INSPECT_PAGE') {
    return undefined;
  }

  void (async () => {
    try {
      const tabId = await getActiveTabId();
      const request: ContentExtractRequest = {
        type: 'FAST_BROWSER_EXTRACT_PAGE_STATE',
        task: message.task,
      };
      const response = await chrome.tabs.sendMessage(tabId, request) as ContentExtractResponse;
      if (!response.ok || !response.pageState) {
        sendResponse({
          ok: false,
          error: response.error ?? 'The content script did not return a page snapshot.',
          feed: [makeFeedEntry('Failed to read the current page.', 'error')],
        } satisfies BackgroundResponse);
        return;
      }

      sendResponse({
        ok: true,
        pageState: response.pageState,
        feed: [
          makeFeedEntry('Connected to the active tab.', 'success'),
          makeFeedEntry(`Captured ${response.pageState.meta.elementCount} interactive elements.`),
        ],
      } satisfies BackgroundResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown extension error.',
        feed: [makeFeedEntry('Unable to inspect the page.', 'error')],
      } satisfies BackgroundResponse);
    }
  })();

  return true;
});

