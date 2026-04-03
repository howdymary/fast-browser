import type { ProviderName, ProviderSettings } from './types';

export const PROVIDER_SETTINGS_STORAGE_KEY = 'fast-browser-provider-settings';
export const PROVIDER_API_KEY_STORAGE_KEY = 'fast-browser-provider-api-key';

const PROVIDER_PRESETS: Record<ProviderName, Omit<ProviderSettings, 'apiKey'>> = {
  openai: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
  },
  anthropic: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    baseUrl: 'https://api.anthropic.com/v1/messages',
  },
  ollama: {
    provider: 'ollama',
    model: 'llama3.2',
    baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
  },
};

export function getProviderPreset(provider: ProviderName): ProviderSettings {
  return {
    ...PROVIDER_PRESETS[provider],
    apiKey: '',
  };
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = getProviderPreset('openai');

export function mergeProviderSettings(value: Partial<ProviderSettings> | undefined): ProviderSettings {
  const provider = value?.provider ?? DEFAULT_PROVIDER_SETTINGS.provider;
  return {
    ...getProviderPreset(provider),
    ...value,
    provider,
    apiKey: value?.apiKey ?? '',
  };
}

export function providerNeedsApiKey(settings: ProviderSettings): boolean {
  return settings.provider !== 'ollama';
}

export function getProviderEndpoint(settings: ProviderSettings): string {
  const trimmedBaseUrl = settings.baseUrl?.trim();
  if (settings.provider === 'anthropic') {
    return trimmedBaseUrl || 'https://api.anthropic.com/v1/messages';
  }
  if (settings.provider === 'openai') {
    return trimmedBaseUrl || 'https://api.openai.com/v1/chat/completions';
  }
  return trimmedBaseUrl || 'http://127.0.0.1:11434/v1/chat/completions';
}

export function validateProviderSettings(settings: ProviderSettings): string | null {
  if (!settings.model.trim()) {
    return 'Choose a model before running the agent.';
  }

  if (providerNeedsApiKey(settings) && !settings.apiKey.trim()) {
    return `An API key is required for ${settings.provider}.`;
  }

  if (settings.provider === 'ollama' && !settings.baseUrl?.trim()) {
    return 'Set an Ollama endpoint before running the agent.';
  }

  const trimmedBaseUrl = settings.baseUrl?.trim();
  if (trimmedBaseUrl) {
    try {
      const url = new URL(trimmedBaseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return 'Base URL must use http or https.';
      }
    } catch {
      return 'Base URL is not a valid URL.';
    }
  }

  return null;
}
