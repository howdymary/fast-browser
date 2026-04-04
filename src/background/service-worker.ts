import type {
  BackgroundMessage,
  BackgroundResponse,
  ContentExecuteRequest,
  ContentExecuteResponse,
  ContentExtractRequest,
  ContentExtractResponse,
  ContentMessage,
  RunEventServerMessage,
  RunFinishServerMessage,
  RunPortClientMessage,
} from '../shared/messages';
import contentScriptFile from '../content/content-script.ts?script';
import { callLlm } from './llm-client';
import { makeFeedEntry, runAgentLoop } from './agent-loop';
import {
  DEFAULT_PROVIDER_SETTINGS,
  mergeProviderSettings,
  PROVIDER_SETTINGS_STORAGE_KEY,
  validateProviderSettings,
} from '../shared/settings';
import type { ExecutableAction, NavigateAction, ProviderSettings, RunPhase } from '../shared/types';

const RUNNER_PORT_NAME = 'fast-browser.run';
const CONTENT_SCRIPT_READY_RETRIES = 8;
const CONTENT_SCRIPT_READY_DELAY_MS = 75;

function throwIfAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function isSupportedTabUrl(url: string | undefined): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error('No active tab is available.');
  }
  return activeTab;
}

async function getActiveTabId(): Promise<number> {
  return (await getActiveTab()).id as number;
}

async function loadProviderSettings(): Promise<ProviderSettings> {
  const stored = await chrome.storage.local.get(PROVIDER_SETTINGS_STORAGE_KEY);
  const persisted = stored[PROVIDER_SETTINGS_STORAGE_KEY] as Partial<ProviderSettings> | undefined;
  return mergeProviderSettings(persisted);
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    function handleAbort(): void {
      globalThis.clearTimeout(timeoutId);
      signal.removeEventListener('abort', handleAbort);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function isMissingReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /receiving end does not exist/i.test(message);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableContentScriptError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /receiving end does not exist/i.test(message)
    || /message port closed before a response was received/i.test(message)
    || /frame .* was removed/i.test(message)
    || /the tab was closed/i.test(message);
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'FAST_BROWSER_PING',
    } satisfies ContentMessage) as { ok?: boolean };
    return response?.ok === true;
  } catch (error) {
    if (isMissingReceiverError(error)) {
      return false;
    }
    throw error;
  }
}

async function waitForContentScriptReady(tabId: number, signal?: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < CONTENT_SCRIPT_READY_RETRIES; attempt += 1) {
    if (signal) {
      throwIfAborted(signal);
    }

    if (await pingContentScript(tabId)) {
      return;
    }

    if (attempt < CONTENT_SCRIPT_READY_RETRIES - 1) {
      if (signal) {
        await abortableDelay(CONTENT_SCRIPT_READY_DELAY_MS, signal);
      } else {
        await new Promise((resolve) => globalThis.setTimeout(resolve, CONTENT_SCRIPT_READY_DELAY_MS));
      }
    }
  }

  throw new Error('Fast Browser could not connect to the page script. Reload the tab and try again.');
}

async function ensureActiveTabAccess(tabId: number, signal?: AbortSignal): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!isSupportedTabUrl(tab.url)) {
    throw new Error('Fast Browser can only run on regular http(s) pages, not browser-internal tabs.');
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [contentScriptFile],
    });
    await waitForContentScriptReady(tabId, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown injection error.';
    throw new Error(`Fast Browser could not access this page. Grant site access or reopen the side panel from the page you want to automate. (${message})`);
  }
}

async function delayForContentScript(signal?: AbortSignal): Promise<void> {
  if (signal) {
    await abortableDelay(CONTENT_SCRIPT_READY_DELAY_MS * 2, signal);
    return;
  }
  await new Promise((resolve) => globalThis.setTimeout(resolve, CONTENT_SCRIPT_READY_DELAY_MS * 2));
}

async function sendContentMessage<ResponseType>(
  tabId: number,
  request: ContentMessage,
  signal?: AbortSignal,
): Promise<ResponseType> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal) {
      throwIfAborted(signal);
    }

    await ensureActiveTabAccess(tabId, signal);

    try {
      return await chrome.tabs.sendMessage(tabId, request) as ResponseType;
    } catch (error) {
      lastError = error;
      if (attempt === 1 || !isRetryableContentScriptError(error)) {
        throw error;
      }
      await delayForContentScript(signal);
    }
  }

  throw lastError ?? new Error('The page script did not respond.');
}

async function extractActivePageState(
  tabId: number,
  task: string | undefined,
  signal?: AbortSignal,
) {
  if (signal) {
    throwIfAborted(signal);
  }
  const request: ContentExtractRequest = {
    type: 'FAST_BROWSER_EXTRACT_PAGE_STATE',
    task,
  };
  const response = await sendContentMessage<ContentExtractResponse>(tabId, request, signal);
  if (signal) {
    throwIfAborted(signal);
  }
  if (!response.ok || !response.pageState) {
    throw new Error(response.error ?? 'The content script did not return a page snapshot.');
  }
  return response.pageState;
}

async function executeContentAction(
  tabId: number,
  action: ExecutableAction,
  snapshotId: string,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const request: ContentExecuteRequest = {
    type: 'FAST_BROWSER_EXECUTE_ACTION',
    action,
    snapshotId,
  };
  const response = await sendContentMessage<ContentExecuteResponse>(tabId, request, signal);
  throwIfAborted(signal);
  if (!response.ok) {
    throw new Error(response.error ?? 'The content script could not execute the action.');
  }
}

async function navigateTab(tabId: number, action: NavigateAction, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await chrome.tabs.update(tabId, { url: action.url });
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, 4000);

    function cleanup(): void {
      globalThis.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdate);
      signal.removeEventListener('abort', handleAbort);
    }

    function handleAbort(): void {
      cleanup();
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }

    function handleUpdate(
      updatedTabId: number,
      changeInfo: { status?: string },
      _tab: chrome.tabs.Tab,
    ): void {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(handleUpdate);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== RUNNER_PORT_NAME) {
    return;
  }

  let started = false;
  let closed = false;
  let controller: AbortController | null = null;
  let runId: string | null = null;
  let seq = 0;
  let finishSent = false;

  function nextSeq(): number {
    seq += 1;
    return seq;
  }

  function postEvent(step: number, phase: RunPhase, entry?: ReturnType<typeof makeFeedEntry>, pageState?: BackgroundResponse['pageState']): void {
    if (closed || !runId) {
      return;
    }
    const message: RunEventServerMessage = {
      type: 'FAST_BROWSER_RUN_EVENT',
      runId,
      seq: nextSeq(),
      step,
      phase,
      entry,
      pageState,
    };
    port.postMessage(message);
  }

  function postFinish(payload: {
    ok: boolean;
    finalMessage?: string;
    error?: string;
    pageState?: BackgroundResponse['pageState'];
  }): void {
    if (closed || !runId || finishSent) {
      return;
    }
    finishSent = true;
    const message: RunFinishServerMessage = {
      type: 'FAST_BROWSER_RUN_FINISH',
      runId,
      seq: nextSeq(),
      ok: payload.ok,
      finalMessage: payload.finalMessage,
      error: payload.error,
      pageState: payload.pageState,
    };
    port.postMessage(message);
  }

  function cancelRun(reason: string): void {
    if (controller && !controller.signal.aborted) {
      controller.abort(new DOMException(reason, 'AbortError'));
    }
  }

  port.onDisconnect.addListener(() => {
    closed = true;
    cancelRun('Port disconnected');
  });

  port.onMessage.addListener((message: RunPortClientMessage) => {
    if (message.type === 'FAST_BROWSER_RUN_CANCEL') {
      if (runId && message.runId === runId) {
        cancelRun('Run cancelled by user');
      }
      return;
    }

    if (message.type !== 'FAST_BROWSER_RUN_START') {
      return;
    }

    if (started) {
      postFinish({
        ok: false,
        error: 'A run is already active on this port.',
      });
      return;
    }

    started = true;
    runId = message.runId;
    controller = new AbortController();

    void (async () => {
      try {
        const tabId = await getActiveTabId();
        throwIfAborted(controller.signal);
        const settings = await loadProviderSettings();
        const settingsError = validateProviderSettings(settings);
        if (settingsError) {
          postEvent(0, 'error', makeFeedEntry(settingsError, 'error'));
          postFinish({ ok: false, error: settingsError });
          return;
        }

        const maxSteps = typeof message.maxSteps === 'number' && Number.isFinite(message.maxSteps)
          ? Math.max(1, Math.min(20, Math.floor(message.maxSteps)))
          : undefined;

        const result = await runAgentLoop(
          {
            task: message.task.trim(),
            settings: settings ?? DEFAULT_PROVIDER_SETTINGS,
            maxSteps,
          },
          {
            signal: controller.signal,
            getPageState: () => extractActivePageState(tabId, message.task, controller!.signal),
            executeAction: async (action, snapshotId) => {
              await executeContentAction(tabId, action, snapshotId, controller!.signal);
              await abortableDelay(action.action === 'click' ? 500 : 150, controller!.signal);
            },
            navigate: async (action) => {
              await navigateTab(tabId, action, controller!.signal);
            },
            callModel: callLlm,
            emitEvent: async (event) => {
              postEvent(event.step, event.phase, event.entry, event.pageState);
            },
          },
        );

        if (!result.ok && result.error?.match(/cancelled/i)) {
          postEvent(0, 'cancelled', makeFeedEntry('Run cancelled.', 'warning'));
        }

        postFinish({
          ok: result.ok,
          finalMessage: result.finalMessage,
          error: result.error,
          pageState: result.pageState,
        });
      } catch (error) {
        const isAbort = error instanceof DOMException && error.name === 'AbortError';
        if (isAbort) {
          postEvent(0, 'cancelled', makeFeedEntry('Run cancelled.', 'warning'));
          postFinish({
            ok: false,
            error: 'Run cancelled.',
          });
          return;
        }

        const messageText = error instanceof Error ? error.message : 'Unknown extension error.';
        postEvent(0, 'error', makeFeedEntry(messageText, 'error'));
        postFinish({
          ok: false,
          error: messageText,
        });
      }
    })();
  });
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  if (message.type !== 'FAST_BROWSER_INSPECT_PAGE') {
    return undefined;
  }

  void (async () => {
    try {
      const tabId = await getActiveTabId();
      const pageState = await extractActivePageState(tabId, message.task);
      sendResponse({
        ok: true,
        pageState,
        feed: [
          makeFeedEntry('Connected to the active tab.', 'success'),
          makeFeedEntry(`Captured ${pageState.meta.elementCount} interactive elements.`),
        ],
      } satisfies BackgroundResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown extension error.',
        feed: [makeFeedEntry('Unable to inspect the current page.', 'error')],
      } satisfies BackgroundResponse);
    }
  })();

  return true;
});
