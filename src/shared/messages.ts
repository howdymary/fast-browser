import type {
  ActionFeedEntry,
  AgentRunResult,
  AgentStatus,
  ExecutableAction,
  PageState,
  RunPhase,
} from './types';

export interface InspectPageRequest {
  type: 'FAST_BROWSER_INSPECT_PAGE';
  task?: string;
}

export interface RunTaskRequest {
  type: 'FAST_BROWSER_RUN_TASK';
  task: string;
}

export interface RunTaskPortRequest {
  type: 'FAST_BROWSER_RUN_START';
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

export interface RunStreamUpdate {
  type: 'FAST_BROWSER_RUN_UPDATE';
  runId: string;
  step: number;
  phase: RunPhase;
  status: AgentStatus;
  feed?: ActionFeedEntry[];
  pageState?: PageState;
  finalMessage?: string;
  error?: string;
  ok?: boolean;
}

export type RunPortMessage = RunTaskPortRequest | RunStreamUpdate;
