import type { AgentRunResult, ExecutableAction, PageState } from './types';

export interface InspectPageRequest {
  type: 'FAST_BROWSER_INSPECT_PAGE';
  task?: string;
}

export interface RunTaskRequest {
  type: 'FAST_BROWSER_RUN_TASK';
  task: string;
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

export interface ContentExecuteRequest {
  type: 'FAST_BROWSER_EXECUTE_ACTION';
  action: ExecutableAction;
  snapshotId: string;
}

export interface ContentExecuteResponse {
  ok: boolean;
  error?: string;
}

export type BackgroundMessage = InspectPageRequest | RunTaskRequest;
export type BackgroundResponse = AgentRunResult;
export type ContentMessage = ContentExtractRequest | ContentExecuteRequest;
export type ContentResponse = ContentExtractResponse | ContentExecuteResponse;
