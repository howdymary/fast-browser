import type { ProviderSettings } from './types';

export const PROVIDER_SETTINGS_STORAGE_KEY = 'fast-browser-provider-settings';
export const OLLAMA_DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions';
const OLLAMA_TAGS_ENDPOINT = 'http://127.0.0.1:11434/api/tags';
const OLLAMA_CHAT_COMPLETIONS_PATH_RE = /\/v1\/chat\/completions\/?$/i;

export interface ProviderModelOption {
  value: string;
  label: string;
  helper?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

const OLLAMA_MODEL_HELPERS: Record<string, string> = {
  'llama3.2:1b': 'Tiny free Llama option for very lightweight local use.',
  'llama3.2:3b': 'Installed local default. Good starting point for free browser actions.',
  'qwen3:0.6b': 'Newest tiny Qwen option if you want the smallest modern free model.',
  'qwen3:1.7b': 'Small modern Qwen model with stronger general reasoning than tiny models.',
  'qwen3:4b': 'Balanced newer Qwen model for local browser tasks.',
  'qwen3:8b': 'Stronger modern Qwen model if your machine can handle it.',
  'qwen3:14b': 'High-quality modern Qwen model for more capable local use.',
  'qwen2.5:0.5b': 'Smallest Qwen 2.5 option for very constrained machines.',
  'qwen2.5:1.5b': 'Lightweight Qwen 2.5 model for modest laptops.',
  'qwen2.5:3b': 'Great lightweight local option if you install it with ollama pull qwen2.5:3b.',
  'qwen2.5:7b': 'Stronger reasoning if you install it and have enough memory.',
  'qwen2.5:14b': 'A more capable Qwen 2.5 option for larger local setups.',
  'qwen2.5-coder:0.5b': 'Small code-oriented Qwen model for dev-heavy browsing tasks.',
  'qwen2.5-coder:1.5b': 'Lightweight code-specialized Qwen option.',
  'qwen2.5-coder:3b': 'Good local coding/browser hybrid model.',
  'qwen2.5-coder:7b': 'Stronger coding-focused local model.',
  'qwen2.5-coder:14b': 'Large code-specialized model if your machine can support it.',
  'deepseek-r1:1.5b': 'Small reasoning-focused DeepSeek distill.',
  'deepseek-r1:7b': 'Strong reasoning-focused free local model.',
  'deepseek-r1:8b': 'Alternative DeepSeek reasoning size with good quality.',
  'deepseek-r1:14b': 'Larger local reasoning model for stronger results.',
  'gemma3:1b': 'Smallest recommended local model for lower-memory laptops.',
  'gemma3:4b': 'A better-quality Gemma option if your machine can handle it.',
  'gemma3:12b': 'High-quality Gemma 3 option for stronger local reasoning.',
  'gemma3:27b': 'Largest Gemma 3 option that some workstation-class setups can run.',
  'mistral:7b': 'Solid classic open model for general local tasks.',
  'phi4:14b': 'Microsoft open model with strong reasoning and writing quality.',
  'phi4-mini:3.8b': 'Smaller Phi option for local reasoning with modest hardware.',
  'codellama:7b': 'Coding-focused model useful for developer workflows in browser.',
  'codellama:13b': 'Larger Code Llama option for code-heavy browsing tasks.',
  'tinyllama:1.1b': 'Very small free local model for basic experiments.',
  'qwopus-q4km-quiet:latest': 'A locally available custom model on this machine.',
  'qwopus-q4km:latest': 'A locally available custom model on this machine.',
};

export const SUGGESTED_OLLAMA_MODELS: ProviderModelOption[] = [
  {
    value: 'llama3.2:1b',
    label: 'Llama 3.2 1B',
    helper: 'Smallest Llama 3.2 local option.',
  },
  {
    value: 'llama3.2:3b',
    label: 'Llama 3.2 3B',
    helper: 'Fastest path if you want a free local model that already works well here.',
  },
  {
    value: 'qwen3:0.6b',
    label: 'Qwen 3 0.6B',
    helper: 'Tiny modern Qwen model for very lightweight local use.',
  },
  {
    value: 'qwen3:1.7b',
    label: 'Qwen 3 1.7B',
    helper: 'A strong small modern Qwen option.',
  },
  {
    value: 'qwen3:4b',
    label: 'Qwen 3 4B',
    helper: 'Balanced newer Qwen model for general local browsing tasks.',
  },
  {
    value: 'qwen3:8b',
    label: 'Qwen 3 8B',
    helper: 'A stronger Qwen 3 option if your machine can handle it.',
  },
  {
    value: 'qwen3:14b',
    label: 'Qwen 3 14B',
    helper: 'High-quality modern Qwen model for more capable local use.',
  },
  {
    value: 'qwen2.5:0.5b',
    label: 'Qwen 2.5 0.5B',
    helper: 'Smallest Qwen 2.5 model for very constrained hardware.',
  },
  {
    value: 'qwen2.5:1.5b',
    label: 'Qwen 2.5 1.5B',
    helper: 'Lightweight Qwen 2.5 option for modest laptops.',
  },
  {
    value: 'qwen2.5:3b',
    label: 'Qwen 2.5 3B',
    helper: 'A strong lightweight free model after running ollama pull qwen2.5:3b.',
  },
  {
    value: 'qwen2.5:14b',
    label: 'Qwen 2.5 14B',
    helper: 'A larger Qwen 2.5 option for stronger local results.',
  },
  {
    value: 'gemma3:1b',
    label: 'Gemma 3 1B',
    helper: 'Smallest recommended free local model for lower-memory laptops.',
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
  {
    value: 'gemma3:12b',
    label: 'Gemma 3 12B',
    helper: 'Higher-quality Gemma 3 model for stronger reasoning.',
  },
  {
    value: 'gemma3:27b',
    label: 'Gemma 3 27B',
    helper: 'Largest Gemma 3 option for workstation-class setups.',
  },
  {
    value: 'deepseek-r1:1.5b',
    label: 'DeepSeek R1 1.5B',
    helper: 'Small reasoning-focused free local model.',
  },
  {
    value: 'deepseek-r1:7b',
    label: 'DeepSeek R1 7B',
    helper: 'Strong reasoning-focused local model.',
  },
  {
    value: 'deepseek-r1:8b',
    label: 'DeepSeek R1 8B',
    helper: 'Alternative reasoning-focused local size.',
  },
  {
    value: 'deepseek-r1:14b',
    label: 'DeepSeek R1 14B',
    helper: 'Larger reasoning-focused model for more capable machines.',
  },
  {
    value: 'qwen2.5-coder:0.5b',
    label: 'Qwen 2.5 Coder 0.5B',
    helper: 'Tiny code-focused local model.',
  },
  {
    value: 'qwen2.5-coder:1.5b',
    label: 'Qwen 2.5 Coder 1.5B',
    helper: 'Small coding-focused Qwen model.',
  },
  {
    value: 'qwen2.5-coder:3b',
    label: 'Qwen 2.5 Coder 3B',
    helper: 'Balanced code-oriented local model.',
  },
  {
    value: 'qwen2.5-coder:7b',
    label: 'Qwen 2.5 Coder 7B',
    helper: 'Stronger code-focused local model.',
  },
  {
    value: 'qwen2.5-coder:14b',
    label: 'Qwen 2.5 Coder 14B',
    helper: 'Large code-specialized local option.',
  },
  {
    value: 'mistral:7b',
    label: 'Mistral 7B',
    helper: 'Solid classic open model for general local tasks.',
  },
  {
    value: 'phi4-mini:3.8b',
    label: 'Phi 4 Mini 3.8B',
    helper: 'Smaller Phi option for local reasoning.',
  },
  {
    value: 'phi4:14b',
    label: 'Phi 4 14B',
    helper: 'Stronger Microsoft open model for local reasoning and writing.',
  },
  {
    value: 'codellama:7b',
    label: 'Code Llama 7B',
    helper: 'Coding-focused local model.',
  },
  {
    value: 'codellama:13b',
    label: 'Code Llama 13B',
    helper: 'Larger code-focused local model.',
  },
  {
    value: 'tinyllama:1.1b',
    label: 'TinyLlama 1.1B',
    helper: 'Very small local model for basic experiments.',
  },
];

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: 'ollama',
  model: 'llama3.2:3b',
  baseUrl: OLLAMA_DEFAULT_ENDPOINT,
};

function normalizeStoredModel(model: string | undefined): string {
  const trimmed = model?.trim();
  if (!trimmed) {
    return DEFAULT_PROVIDER_SETTINGS.model;
  }
  if (/^(gpt-|claude)/i.test(trimmed)) {
    return DEFAULT_PROVIDER_SETTINGS.model;
  }
  return trimmed;
}

function normalizeStoredBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return OLLAMA_DEFAULT_ENDPOINT;
  }
  if (/api\.openai\.com|api\.anthropic\.com/i.test(trimmed)) {
    return OLLAMA_DEFAULT_ENDPOINT;
  }
  return trimmed;
}

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
    model: normalizeStoredModel(value?.model),
    baseUrl: normalizeStoredBaseUrl(value?.baseUrl),
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
    if (!OLLAMA_CHAT_COMPLETIONS_PATH_RE.test(url.pathname)) {
      return 'Ollama endpoint must end with /v1/chat/completions.';
    }
  } catch {
    return 'Ollama endpoint is not a valid URL.';
  }

  return null;
}
