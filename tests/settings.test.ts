import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROVIDER_SETTINGS,
  getProviderEndpoint,
  mergeProviderSettings,
  providerNeedsApiKey,
  validateProviderSettings,
} from '../src/shared/settings';
import type { ProviderSettings } from '../src/shared/types';

describe('validateProviderSettings', () => {
  it('returns null for valid Ollama settings (no API key needed)', () => {
    const settings: ProviderSettings = {
      provider: 'ollama',
      apiKey: '',
      model: 'llama3.2',
      baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    };
    expect(validateProviderSettings(settings)).toBeNull();
  });

  it('returns an error for Anthropic with an empty API key', () => {
    const settings: ProviderSettings = {
      provider: 'anthropic',
      apiKey: '',
      model: 'claude-sonnet-4-20250514',
      baseUrl: '',
    };
    const result = validateProviderSettings(settings);
    expect(result).toBeTypeOf('string');
    expect(result).toMatch(/api key/i);
  });

  it('returns an error for OpenAI with an empty API key', () => {
    const settings: ProviderSettings = {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o',
      baseUrl: '',
    };
    const result = validateProviderSettings(settings);
    expect(result).toBeTypeOf('string');
    expect(result).toMatch(/api key/i);
  });

  it('returns an error for an empty model name', () => {
    const settings: ProviderSettings = {
      provider: 'ollama',
      apiKey: '',
      model: '   ',
      baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    };
    const result = validateProviderSettings(settings);
    expect(result).toBeTypeOf('string');
    expect(result).toMatch(/model/i);
  });

  it('returns an error for Ollama with no baseUrl', () => {
    const settings: ProviderSettings = {
      provider: 'ollama',
      apiKey: '',
      model: 'llama3.2',
      baseUrl: '',
    };
    const result = validateProviderSettings(settings);
    expect(result).toBeTypeOf('string');
    expect(result).toMatch(/endpoint/i);
  });

  it('returns an error for a malformed base URL', () => {
    const settings: ProviderSettings = {
      provider: 'anthropic',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'not-a-url',
    };
    const result = validateProviderSettings(settings);
    expect(result).toBeTypeOf('string');
    expect(result).toMatch(/valid url/i);
  });
});

describe('mergeProviderSettings', () => {
  it('fills defaults when given a partial input', () => {
    const merged = mergeProviderSettings({ provider: 'anthropic' });
    expect(merged.provider).toBe('anthropic');
    expect(merged.model).toBe(DEFAULT_PROVIDER_SETTINGS.model);
    expect(merged.apiKey).toBe(DEFAULT_PROVIDER_SETTINGS.apiKey);
    expect(merged.baseUrl).toBe(DEFAULT_PROVIDER_SETTINGS.baseUrl);
  });

  it('preserves all values when given a full input', () => {
    const full: ProviderSettings = {
      provider: 'openai',
      apiKey: 'sk-test-key',
      model: 'gpt-4o',
      baseUrl: 'https://custom.endpoint/v1',
    };
    const merged = mergeProviderSettings(full);
    expect(merged).toEqual(full);
  });

  it('returns defaults when given undefined', () => {
    const merged = mergeProviderSettings(undefined);
    expect(merged).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });
});

describe('provider endpoint helpers', () => {
  it('uses the provider defaults when no base URL is supplied', () => {
    expect(
      getProviderEndpoint({
        provider: 'anthropic',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-20250514',
      }),
    ).toBe('https://api.anthropic.com/v1/messages');

    expect(
      getProviderEndpoint({
        provider: 'openai',
        apiKey: 'openai-key',
        model: 'gpt-4o',
      }),
    ).toBe('https://api.openai.com/v1/chat/completions');

    expect(
      getProviderEndpoint({
        provider: 'ollama',
        apiKey: '',
        model: 'llama3.2',
      }),
    ).toBe('http://127.0.0.1:11434/v1/chat/completions');
  });

  it('reports which providers require an API key', () => {
    expect(providerNeedsApiKey({
      provider: 'ollama',
      apiKey: '',
      model: 'llama3.2',
    })).toBe(false);

    expect(providerNeedsApiKey({
      provider: 'anthropic',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-20250514',
    })).toBe(true);
  });
});
