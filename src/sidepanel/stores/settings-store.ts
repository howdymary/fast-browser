import { create } from 'zustand';

import {
  DEFAULT_PROVIDER_SETTINGS,
  mergeProviderSettings,
  PROVIDER_SETTINGS_STORAGE_KEY,
} from '../../shared/settings';
import type { ProviderSettings } from '../../shared/types';

interface SettingsStoreState {
  settings: ProviderSettings;
  loaded: boolean;
  setSettings: (settings: ProviderSettings) => void;
  updateSettings: (patch: Partial<ProviderSettings>) => void;
  load: () => Promise<void>;
  save: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: DEFAULT_PROVIDER_SETTINGS,
  loaded: false,
  setSettings: (settings) => set({ settings }),
  updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
  load: async () => {
    const stored = await chrome.storage.local.get(PROVIDER_SETTINGS_STORAGE_KEY);
    set({
      settings: mergeProviderSettings(stored[PROVIDER_SETTINGS_STORAGE_KEY] as Partial<ProviderSettings> | undefined),
      loaded: true,
    });
  },
  save: async () => {
    const settings = get().settings;
    await chrome.storage.local.set({ [PROVIDER_SETTINGS_STORAGE_KEY]: settings });
  },
}));
