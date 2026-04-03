import type { ActionFeedEntry, PageState } from './types';

export interface InspectPageRequest {
  type: 'FAST_BROWSER_INSPECT_PAGE';
  task?: string;
}

export interface InspectPageResponse {
  ok: boolean;
  pageState?: PageState;
  feed?: ActionFeedEntry[];
  error?: string;
}

export interface ContentExtractRequest {
  type: 'FAST_BROWSER_EXTRACT_PAGE_STATE';
  task?: string;
}

export interface ContentExtractResponse {
  ok: boolean;
  pageState?: PageState;
  error?: string;
}

export type BackgroundMessage = InspectPageRequest;
export type BackgroundResponse = InspectPageResponse;
export type ContentMessage = ContentExtractRequest;
export type ContentResponse = ContentExtractResponse;

