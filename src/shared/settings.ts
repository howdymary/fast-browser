import type { ProviderName, ProviderSettings } from './types';

export const PROVIDER_SETTINGS_STORAGE_KEY = 'fast-browser-provider-settings';
export const PROVIDER_API_KEY_STORAGE_KEY = 'fast-browser-provider-api-key';
const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const OPENAI_LEGACY_CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export interface ProviderModelOption {
  value: string;
  label: string;
  helper?: string;
}

const PROVIDER_PRESETS: Record<ProviderName, Omit<ProviderSettings, 'apiKey'>> = {
  openai: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    baseUrl: OPENAI_RESPONSES_ENDPOINT,
  },
  anthropic: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    baseUrl: 'https://api.anthropic.com/v1/messages',
  },
  ollama: {
    provider: 'ollama',
    model: 'llama3.2:3b',
    baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
  },
};

const PROVIDER_MODEL_OPTIONS: Record<ProviderName, ProviderModelOption[]> = {
  openai: [
    {
      value: 'gpt-4.1-mini',
      label: 'GPT-4.1 mini',
      helper: 'Fast and inexpensive default for browser actions.',
    },
    {
      value: 'gpt-4.1',
      label: 'GPT-4.1',
      helper: 'More capable reasoning for harder multi-step tasks.',
    },
    {
      value: 'gpt-4o-mini',
      label: 'GPT-4o mini',
      helper: 'Lightweight multimodal option if your account supports it.',
    },
  ],
  anthropic: [
    {
      value: 'claude-sonnet-4-20250514',
      label: 'Claude Sonnet 4',
      helper: 'Best default Anthropic model for agent-style browsing.',
    },
    {
      value: 'claude-3-7-sonnet-latest',
      label: 'Claude 3.7 Sonnet',
      helper: 'Good fallback if your Anthropic account is on older defaults.',
    },
  ],
  ollama: [
    {
      value: 'qwen2.5:3b',
      label: 'Qwen 2.5 3B',
      helper: 'Best lightweight local default for no-cost use.',
    },
    {
      value: 'llama3.2:3b',
      label: 'Llama 3.2 3B',
      helper: 'Strong local all-arounder for summarization and basic control.',
    },
    {
      value: 'gemma3:1b',
      label: 'Gemma 3 1B',
      helper: 'Smallest easy local option for low-memory laptops.',
    },
    {
      value: 'gemma3:4b',
      label: 'Gemma 3 4B',
      helper: 'Better quality if your machine can handle a larger local model.',
    },
    {
      value: 'qwen2.5:7b',
      label: 'Qwen 2.5 7B',
      helper: 'Better reasoning if you have enough RAM/VRAM.',
    },
  ],
};

export function getProviderPreset(provider: ProviderName): ProviderSettings {
  return {
    ...PROVIDER_PRESETS[provider],
    apiKey: '',
  };
}

export function getProviderModelOptions(provider: ProviderName): ProviderModelOption[] {
  return PROVIDER_MODEL_OPTIONS[provider];
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = getProviderPreset('openai');

export function mergeProviderSettings(value: Partial<ProviderSettings> | undefined): ProviderSettings {
  const provider = value?.provider ?? DEFAULT_PROVIDER_SETTINGS.provider;
  const baseUrl = provider === 'openai'
    && (!value?.baseUrl || value.baseUrl.trim() === OPENAI_LEGACY_CHAT_ENDPOINT)
    ? OPENAI_RESPONSES_ENDPOINT
    : value?.baseUrl;
  return {
    ...getProviderPreset(provider),
    ...value,
    provider,
    apiKey: value?.apiKey ?? '',
    ...(baseUrl ? { baseUrl } : {}),
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
    return trimmedBaseUrl || OPENAI_RESPONSES_ENDPOINT;
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
