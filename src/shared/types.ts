export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'asking' | 'error';

export type ProviderName = 'anthropic' | 'openai' | 'ollama';

export interface ProviderSettings {
  provider: ProviderName;
  apiKey: string;
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
  url: string;
  title: string;
  visibleText: string;
  elements: ElementRef[];
  meta: PageMeta;
}

export interface ActionFeedEntry {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}
