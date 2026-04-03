import { create } from 'zustand';

import type { ActionFeedEntry, AgentStatus, PageState, RunPhase } from '../../shared/types';

interface AgentStoreState {
  task: string;
  status: AgentStatus;
  phase: RunPhase | null;
  currentRunId: string | null;
  pageState: PageState | null;
  feed: ActionFeedEntry[];
  error: string | null;
  setTask: (task: string) => void;
  setStatus: (status: AgentStatus) => void;
  setPhase: (phase: RunPhase | null) => void;
  setCurrentRunId: (runId: string | null) => void;
  setPageState: (pageState: PageState | null) => void;
  appendFeed: (entries: ActionFeedEntry[]) => void;
  setError: (error: string | null) => void;
  resetFeed: () => void;
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  task: '',
  status: 'idle',
  phase: null,
  currentRunId: null,
  pageState: null,
  feed: [],
  error: null,
  setTask: (task) => set({ task }),
  setStatus: (status) => set({ status }),
  setPhase: (phase) => set({ phase }),
  setCurrentRunId: (currentRunId) => set({ currentRunId }),
  setPageState: (pageState) => set({ pageState }),
  appendFeed: (entries) => set((state) => ({ feed: [...state.feed, ...entries] })),
  setError: (error) => set({ error }),
  resetFeed: () => set({ feed: [] }),
}));
