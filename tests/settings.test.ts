import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PROVIDER_SETTINGS,
  fetchInstalledModelOptions,
  getProviderEndpoint,
  getSuggestedModelOptions,
  mergeProviderSettings,
  validateProviderSettings,
} from '../src/shared/settings';
import type { ProviderSettings } from '../src/shared/types';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('validateProviderSettings', () => {
  it('accepts valid Ollama settings', () => {
    const settings: ProviderSettings = {
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    };

    expect(validateProviderSettings(settings)).toBeNull();
  });

  it('rejects an empty model name', () => {
    const result = validateProviderSettings({
      provider: 'ollama',
      model: '   ',
      baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    });

    expect(result).toMatch(/model/i);
  });

  it('rejects a missing Ollama endpoint', () => {
    const result = validateProviderSettings({
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: '',
    });

    expect(result).toMatch(/endpoint/i);
  });

  it('rejects a malformed endpoint', () => {
    const result = validateProviderSettings({
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: 'not-a-url',
    });

    expect(result).toMatch(/valid url/i);
  });
});

describe('mergeProviderSettings', () => {
  it('returns Ollama defaults when given undefined', () => {
    expect(mergeProviderSettings(undefined)).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  it('preserves local Ollama settings', () => {
    expect(
      mergeProviderSettings({
        provider: 'ollama',
        model: 'qwen2.5:7b',
        baseUrl: 'http://localhost:11434/v1/chat/completions',
      }),
    ).toEqual({
      provider: 'ollama',
      model: 'qwen2.5:7b',
      baseUrl: 'http://localhost:11434/v1/chat/completions',
    });
  });

  it('migrates old remote-provider settings to the local Ollama defaults', () => {
    expect(
      mergeProviderSettings({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1/responses',
      }),
    ).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });
});

describe('Ollama helpers', () => {
  it('defaults first-run settings to Ollama', () => {
    expect(DEFAULT_PROVIDER_SETTINGS).toEqual({
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    });
  });

  it('returns the default endpoint when none is supplied', () => {
    expect(
      getProviderEndpoint({
        provider: 'ollama',
        model: 'llama3.2:3b',
      }),
    ).toBe('http://127.0.0.1:11434/v1/chat/completions');
  });

  it('returns the suggested free-model catalog', () => {
    const suggested = getSuggestedModelOptions();
    expect(suggested.some((option) => option.value === 'llama3.2:3b')).toBe(true);
    expect(suggested.some((option) => option.value === 'qwen2.5:3b')).toBe(true);
    expect(suggested.some((option) => option.value === 'qwen2.5:7b')).toBe(true);
    expect(suggested.some((option) => option.value === 'gemma3:1b')).toBe(true);
    expect(suggested.some((option) => option.value === 'gemma3:4b')).toBe(true);
  });
});

describe('fetchInstalledModelOptions', () => {
  it('returns sorted unique installed models from the Ollama tags endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        models: [
          { name: 'qwen2.5:3b' },
          { name: 'llama3.2:3b' },
          { name: 'llama3.2:3b' },
        ],
      }),
    });

    const models = await fetchInstalledModelOptions(fetchMock);

    expect(models.map((model) => model.value)).toEqual(['llama3.2:3b', 'qwen2.5:3b']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws a useful error when Ollama is unreachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    await expect(fetchInstalledModelOptions(fetchMock)).rejects.toThrow(/could not reach ollama/i);
  });
});
