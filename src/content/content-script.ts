import type { ContentExtractRequest, ContentExtractResponse } from '../shared/messages';
import { extractPageState } from './dom-extractor';

chrome.runtime.onMessage.addListener((message: ContentExtractRequest, _sender, sendResponse) => {
  if (message.type !== 'FAST_BROWSER_EXTRACT_PAGE_STATE') {
    return undefined;
  }

  try {
    sendResponse({
      ok: true,
      pageState: extractPageState(document),
    } satisfies ContentExtractResponse);
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown extraction error.',
    } satisfies ContentExtractResponse);
  }

  return true;
});

