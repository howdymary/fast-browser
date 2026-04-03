import { create } from 'zustand';

import {
  PROVIDER_API_KEY_STORAGE_KEY,
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
    const [stored, sessionStored] = await Promise.all([
      chrome.storage.local.get(PROVIDER_SETTINGS_STORAGE_KEY),
      chrome.storage.session.get(PROVIDER_API_KEY_STORAGE_KEY),
    ]);
    const persisted = stored[PROVIDER_SETTINGS_STORAGE_KEY] as Partial<ProviderSettings> | undefined;
    const sessionApiKey = sessionStored[PROVIDER_API_KEY_STORAGE_KEY];
    const apiKey = typeof sessionApiKey === 'string'
      ? sessionApiKey
      : (typeof persisted?.apiKey === 'string' ? persisted.apiKey : '');
    set({
      settings: mergeProviderSettings({
        ...persisted,
        apiKey,
      }),
      loaded: true,
    });
  },
  save: async () => {
    const settings = get().settings;
    const { apiKey, ...persisted } = settings;
    await Promise.all([
      chrome.storage.local.set({ [PROVIDER_SETTINGS_STORAGE_KEY]: persisted }),
      chrome.storage.session.set({ [PROVIDER_API_KEY_STORAGE_KEY]: apiKey }),
    ]);
  },
}));
