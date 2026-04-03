import type {
  ActionFeedEntry,
  AgentRunResult,
  ExecutableAction,
  PageState,
  RunPhase,
} from './types';

export interface InspectPageRequest {
  type: 'FAST_BROWSER_INSPECT_PAGE';
  task?: string;
}

export interface RunStartClientMessage {
  type: 'FAST_BROWSER_RUN_START';
  runId: string;
  task: string;
  maxSteps?: number;
}

export interface RunCancelClientMessage {
  type: 'FAST_BROWSER_RUN_CANCEL';
  runId: string;
}

export interface ContentExtractRequest {
  type: 'FAST_BROWSER_EXTRACT_PAGE_STATE';
  task?: string;
}

export interface ContentPingRequest {
  type: 'FAST_BROWSER_PING';
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

export type BackgroundMessage = InspectPageRequest;
export type BackgroundResponse = AgentRunResult;
export type ContentMessage = ContentPingRequest | ContentExtractRequest | ContentExecuteRequest;
export type ContentResponse = { ok: boolean } | ContentExtractResponse | ContentExecuteResponse;

export interface RunEventServerMessage {
  type: 'FAST_BROWSER_RUN_EVENT';
  runId: string;
  seq: number;
  step: number;
  phase: RunPhase;
  entry?: ActionFeedEntry;
  pageState?: PageState;
}

export interface RunFinishServerMessage {
  type: 'FAST_BROWSER_RUN_FINISH';
  runId: string;
  seq: number;
  ok: boolean;
  finalMessage?: string;
  error?: string;
  pageState?: PageState;
}

export type RunPortClientMessage = RunStartClientMessage | RunCancelClientMessage;
export type RunPortServerMessage = RunEventServerMessage | RunFinishServerMessage;
