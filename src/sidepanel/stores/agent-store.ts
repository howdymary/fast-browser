import { create } from 'zustand';

import type { ActionFeedEntry, PageState, RunPhase } from '../../shared/types';

interface AgentStoreState {
  task: string;
  phase: RunPhase | null;
  currentRunId: string | null;
  lastSeq: number;
  pageState: PageState | null;
  feed: ActionFeedEntry[];
  error: string | null;
  setTask: (task: string) => void;
  setPhase: (phase: RunPhase | null) => void;
  setCurrentRunId: (runId: string | null) => void;
  setLastSeq: (lastSeq: number) => void;
  setPageState: (pageState: PageState | null) => void;
  appendFeed: (entries: ActionFeedEntry[]) => void;
  setError: (error: string | null) => void;
  resetFeed: () => void;
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  task: '',
  phase: null,
  currentRunId: null,
  lastSeq: 0,
  pageState: null,
  feed: [],
  error: null,
  setTask: (task) => set({ task }),
  setPhase: (phase) => set({ phase }),
  setCurrentRunId: (currentRunId) => set({ currentRunId }),
  setLastSeq: (lastSeq) => set({ lastSeq }),
  setPageState: (pageState) => set({ pageState }),
  appendFeed: (entries) => set((state) => ({ feed: [...state.feed, ...entries].slice(-200) })),
  setError: (error) => set({ error }),
  resetFeed: () => set({ feed: [] }),
}));
