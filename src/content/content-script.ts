import type {
  ContentExecuteRequest,
  ContentExecuteResponse,
  ContentExtractRequest,
  ContentExtractResponse,
  ContentMessage,
} from '../shared/messages';
import { executeAction, type SnapshotCache } from './action-executor';
import { extractPageState, FAST_BROWSER_REF_ATTR } from './dom-extractor';

let latestSnapshot: SnapshotCache | null = null;

declare global {
  interface Window {
    __FAST_BROWSER_CONTENT_SCRIPT_READY__?: boolean;
  }
}

function observePage(): ContentExtractResponse {
  const pageState = extractPageState(document);
  const elementsByRef = new Map<string, HTMLElement>();

  for (const element of Array.from(document.querySelectorAll<HTMLElement>(`[${FAST_BROWSER_REF_ATTR}]`))) {
    const ref = element.getAttribute(FAST_BROWSER_REF_ATTR);
    if (ref) {
      elementsByRef.set(ref, element);
    }
  }

  latestSnapshot = {
    snapshotId: pageState.snapshotId,
    elementsByRef,
  };

  return {
    ok: true,
    pageState,
  } satisfies ContentExtractResponse;
}

if (!window.__FAST_BROWSER_CONTENT_SCRIPT_READY__) {
  window.__FAST_BROWSER_CONTENT_SCRIPT_READY__ = true;

  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    if (message.type === 'FAST_BROWSER_EXTRACT_PAGE_STATE') {
      try {
        sendResponse({
          ok: true,
          pageState: observePage().pageState,
        } satisfies ContentExtractResponse);
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown extraction error.',
        } satisfies ContentExtractResponse);
      }

      return true;
    }

    if (message.type === 'FAST_BROWSER_EXECUTE_ACTION') {
      void (async () => {
        try {
          const executeRequest = message as ContentExecuteRequest;
          await executeAction(executeRequest.action, executeRequest.snapshotId, latestSnapshot);
          sendResponse({
            ok: true,
          } satisfies ContentExecuteResponse);
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown action error.',
          } satisfies ContentExecuteResponse);
        }
      })();

      return true;
    }

    return undefined;
  });
}
