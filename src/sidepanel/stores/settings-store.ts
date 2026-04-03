import { create } from 'zustand';

import {
  DEFAULT_PROVIDER_SETTINGS,
  mergeProviderSettings,
  PROVIDER_SETTINGS_STORAGE_KEY,
} from '../../shared/settings';
import type { ProviderSettings } from '../../shared/types';

const LEGACY_PROVIDER_API_KEY_STORAGE_KEY = 'fast-browser-provider-api-key';

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
    const persisted = stored[PROVIDER_SETTINGS_STORAGE_KEY] as Partial<ProviderSettings> | undefined;
    set({
      settings: mergeProviderSettings(persisted),
      loaded: true,
    });
  },
  save: async () => {
    const settings = get().settings;
    await Promise.all([
      chrome.storage.local.set({ [PROVIDER_SETTINGS_STORAGE_KEY]: settings }),
      chrome.storage.session.remove(LEGACY_PROVIDER_API_KEY_STORAGE_KEY),
    ]);
  },
}));
