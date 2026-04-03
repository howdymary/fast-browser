import type { ProviderSettings } from './types';

export const PROVIDER_SETTINGS_STORAGE_KEY = 'fast-browser-provider-settings';
export const OLLAMA_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions';
const OLLAMA_TAGS_ENDPOINT = 'http://127.0.0.1:11434/api/tags';

export interface ProviderModelOption {
  value: string;
  label: string;
  helper?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

const OLLAMA_MODEL_HELPERS: Record<string, string> = {
  'llama3.2:3b': 'Installed local default. Good starting point for free browser actions.',
  'qwen2.5:3b': 'Great lightweight local option if you install it with ollama pull qwen2.5:3b.',
  'qwen2.5:7b': 'Stronger reasoning if you install it and have enough memory.',
  'gemma3:1b': 'Smallest recommended local model for lower-memory laptops.',
  'gemma3:4b': 'A better-quality Gemma option if your machine can handle it.',
  'qwopus-q4km-quiet:latest': 'A locally available custom model on this machine.',
  'qwopus-q4km:latest': 'A locally available custom model on this machine.',
};

export const SUGGESTED_OLLAMA_MODELS: ProviderModelOption[] = [
  {
    value: 'llama3.2:3b',
    label: 'Llama 3.2 3B',
    helper: 'Fastest path if you want a free local model that already works well here.',
  },
  {
    value: 'qwen2.5:3b',
    label: 'Qwen 2.5 3B',
    helper: 'A strong lightweight free model after running ollama pull qwen2.5:3b.',
  },
  {
    value: 'gemma3:4b',
    label: 'Gemma 3 4B',
    helper: 'A good higher-quality free local option after installation.',
  },
  {
    value: 'qwen2.5:7b',
    label: 'Qwen 2.5 7B',
    helper: 'Use only if your machine has enough RAM and you install it first.',
  },
];

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: 'ollama',
  model: 'llama3.2:3b',
  baseUrl: OLLAMA_DEFAULT_ENDPOINT,
};

function prettifyModelName(model: string): string {
  const helper = OLLAMA_MODEL_HELPERS[model];
  if (helper) {
    const label = SUGGESTED_OLLAMA_MODELS.find((option) => option.value === model)?.label;
    return label ?? model;
  }

  return model
    .replace(/:latest$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function helperForModel(model: string): string | undefined {
  return OLLAMA_MODEL_HELPERS[model];
}

export function mergeProviderSettings(
  value: Partial<Omit<ProviderSettings, 'provider'> & { apiKey?: string; provider?: string }> | undefined,
): ProviderSettings {
  return {
    ...DEFAULT_PROVIDER_SETTINGS,
    model: value?.model?.trim() || DEFAULT_PROVIDER_SETTINGS.model,
    baseUrl: value?.baseUrl?.trim() || DEFAULT_PROVIDER_SETTINGS.baseUrl,
    provider: 'ollama',
  };
}

export function getProviderEndpoint(settings: ProviderSettings): string {
  return settings.baseUrl?.trim() || OLLAMA_DEFAULT_ENDPOINT;
}

export function getSuggestedModelOptions(): ProviderModelOption[] {
  return SUGGESTED_OLLAMA_MODELS;
}

export async function fetchInstalledModelOptions(
  fetcher: typeof fetch = fetch,
): Promise<ProviderModelOption[]> {
  const response = await fetcher(OLLAMA_TAGS_ENDPOINT, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Could not reach Ollama (${response.status}).`);
  }

  const data = await response.json() as OllamaTagsResponse;
  const names = (data.models ?? [])
    .map((model) => model.name?.trim() || '')
    .filter(Boolean);

  const uniqueNames = Array.from(new Set(names)).sort((left, right) => left.localeCompare(right));

  return uniqueNames.map((name) => ({
    value: name,
    label: prettifyModelName(name),
    helper: helperForModel(name) ?? 'Installed locally and ready to use.',
  }));
}

export function validateProviderSettings(settings: ProviderSettings): string | null {
  if (!settings.model.trim()) {
    return 'Choose or type an Ollama model before running the agent.';
  }

  if (!settings.baseUrl?.trim()) {
    return 'Set an Ollama endpoint before running the agent.';
  }

  const trimmedBaseUrl = settings.baseUrl.trim();
  try {
    const url = new URL(trimmedBaseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Ollama endpoint must use http or https.';
    }
  } catch {
    return 'Ollama endpoint is not a valid URL.';
  }

  return null;
}
