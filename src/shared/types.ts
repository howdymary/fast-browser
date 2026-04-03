export type ProviderName = 'ollama';

export interface ProviderSettings {
  provider: ProviderName;
  model: string;
  baseUrl?: string;
}

export interface PageMeta {
  hasForm: boolean;
  hasDialog: boolean;
  scrollPercent: number;
  loadingState: DocumentReadyState;
  elementCount: number;
}

export interface ElementRef {
  ref: string;
  tag: string;
  role: string;
  name: string;
  type?: string;
  state?: string[];
  value?: string;
  context?: string;
  sensitive?: boolean;
  inViewport: boolean;
}

export interface PageState {
  snapshotId: string;
  url: string;
  title: string;
  visibleText: string;
  elements: ElementRef[];
  meta: PageMeta;
}

export interface ClickAction {
  action: 'click';
  ref: string;
  reason: string;
}

export interface TypeAction {
  action: 'type';
  ref: string;
  text: string;
  reason: string;
}

export interface ScrollAction {
  action: 'scroll';
  direction: 'up' | 'down';
  reason: string;
}

export interface NavigateAction {
  action: 'navigate';
  url: string;
  reason: string;
}

export interface WaitAction {
  action: 'wait';
  ms: number;
  reason: string;
}

export interface AskHumanAction {
  action: 'ask_human';
  question: string;
  reason: string;
}

export interface DoneAction {
  action: 'done';
  result: string;
  reason: string;
}

export type AgentAction =
  | ClickAction
  | TypeAction
  | ScrollAction
  | NavigateAction
  | WaitAction
  | AskHumanAction
  | DoneAction;

export type ExecutableAction =
  | ClickAction
  | TypeAction
  | ScrollAction
  | WaitAction;

export interface ActionFeedEntry {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

export interface AgentRunResult {
  ok: boolean;
  pageState?: PageState;
  feed: ActionFeedEntry[];
  finalMessage?: string;
  error?: string;
}

export type RunPhase =
  | 'observe'
  | 'plan'
  | 'act'
  | 'verify'
  | 'awaiting-human'
  | 'done'
  | 'cancelled'
  | 'error';
