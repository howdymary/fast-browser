import { create } from 'zustand';

import type { ActionFeedEntry, AgentStatus, PageState } from '../../shared/types';

interface AgentStoreState {
  task: string;
  status: AgentStatus;
  pageState: PageState | null;
  feed: ActionFeedEntry[];
  error: string | null;
  setTask: (task: string) => void;
  setStatus: (status: AgentStatus) => void;
  setPageState: (pageState: PageState | null) => void;
  appendFeed: (entries: ActionFeedEntry[]) => void;
  setError: (error: string | null) => void;
  resetFeed: () => void;
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  task: '',
  status: 'idle',
  pageState: null,
  feed: [],
  error: null,
  setTask: (task) => set({ task }),
  setStatus: (status) => set({ status }),
  setPageState: (pageState) => set({ pageState }),
  appendFeed: (entries) => set((state) => ({ feed: [...state.feed, ...entries] })),
  setError: (error) => set({ error }),
  resetFeed: () => set({ feed: [] }),
}));

