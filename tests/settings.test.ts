import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PROVIDER_SETTINGS,
  fetchInstalledModelOptions,
  getProviderEndpoint,
  getSuggestedModelOptions,
  mergeProviderSettings,
  OLLAMA_DEFAULT_ENDPOINT,
  validateProviderSettings,
} from '../src/shared/settings';
import type { ProviderSettings } from '../src/shared/types';

describe('validateProviderSettings', () => {
  it('returns null for valid Ollama settings', () => {
    const settings: ProviderSettings = {
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: OLLAMA_DEFAULT_ENDPOINT,
    };
    expect(validateProviderSettings(settings)).toBeNull();
  });

  it('returns an error for an empty model name', () => {
    const settings: ProviderSettings = {
      provider: 'ollama',
      model: '   ',
      baseUrl: OLLAMA_DEFAULT_ENDPOINT,
    };
    expect(validateProviderSettings(settings)).toMatch(/model/i);
  });

  it('returns an error for Ollama with no endpoint', () => {
    const settings: ProviderSettings = {
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: '',
    };
    expect(validateProviderSettings(settings)).toMatch(/endpoint/i);
  });

  it('returns an error for a malformed base URL', () => {
    const settings: ProviderSettings = {
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: 'not-a-url',
    };
    expect(validateProviderSettings(settings)).toMatch(/valid url/i);
  });
});

describe('mergeProviderSettings', () => {
  it('fills Ollama defaults when given a partial input', () => {
    const merged = mergeProviderSettings({ model: 'qwen2.5:3b' });
    expect(merged.provider).toBe('ollama');
    expect(merged.model).toBe('qwen2.5:3b');
    expect(merged.baseUrl).toBe(OLLAMA_DEFAULT_ENDPOINT);
  });

  it('preserves all valid values when given a full input', () => {
    const full: ProviderSettings = {
      provider: 'ollama',
      model: 'qwen2.5:7b',
      baseUrl: 'http://localhost:11434/v1/chat/completions',
    };
    expect(mergeProviderSettings(full)).toEqual(full);
  });

  it('returns defaults when given undefined', () => {
    expect(mergeProviderSettings(undefined)).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  it('migrates old saved provider data back to Ollama defaults', () => {
    const merged = mergeProviderSettings({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'llama3.2:3b',
      baseUrl: '',
    });

    expect(merged.provider).toBe('ollama');
    expect(merged.baseUrl).toBe(OLLAMA_DEFAULT_ENDPOINT);
  });
});

describe('Ollama helper functions', () => {
  it('defaults first-run settings to the local Ollama path', () => {
    expect(DEFAULT_PROVIDER_SETTINGS).toEqual({
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: OLLAMA_DEFAULT_ENDPOINT,
    });
  });

  it('returns suggested free model options', () => {
    const models = getSuggestedModelOptions();
    expect(models.some((option) => option.value === 'llama3.2:3b')).toBe(true);
    expect(models.some((option) => option.value === 'qwen2.5:7b')).toBe(true);
  });

  it('uses the default Ollama endpoint when none is supplied', () => {
    expect(
      getProviderEndpoint({
        provider: 'ollama',
        model: 'llama3.2:3b',
      }),
    ).toBe(OLLAMA_DEFAULT_ENDPOINT);
  });

  it('reads installed models from the Ollama tags endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        models: [
          { name: 'llama3.2:3b' },
          { name: 'qwopus-q4km-quiet:latest' },
        ],
      }),
    });

    const result = await fetchInstalledModelOptions(fetchMock);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.map((item) => item.value)).toEqual([
      'llama3.2:3b',
      'qwopus-q4km-quiet:latest',
    ]);
  });

  it('throws a helpful error when Ollama is unreachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchInstalledModelOptions(fetchMock)).rejects.toThrow(/could not reach ollama/i);
  });
});
