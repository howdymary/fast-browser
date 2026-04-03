import { afterEach, describe, expect, it, vi } from 'vitest';

import { callLlm } from '../src/background/llm-client';
import type { ProviderSettings } from '../src/shared/types';

function makeSettings(provider: ProviderSettings['provider']): ProviderSettings {
  if (provider === 'anthropic') {
    return {
      provider,
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.anthropic.com/v1/messages',
    };
  }

  if (provider === 'openai') {
    return {
      provider,
      apiKey: 'openai-key',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1/chat/completions',
    };
  }

  return {
    provider,
    apiKey: '',
    model: 'llama3.2',
    baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('callLlm', () => {
  it('returns trimmed Anthropiс content and sends max_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ text: '  hello from anthropic  ' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const settings = makeSettings('anthropic');
    const result = await callLlm('System prompt', [{ role: 'user', content: 'Hi' }], settings);

    expect(result).toBe('hello from anthropic');
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
      }),
    });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: settings.model,
      max_tokens: 400,
      system: 'System prompt',
      messages: [{ role: 'user', content: 'Hi' }],
    });
  });

  it('returns OpenAI chat content and sends max_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: '  hello from openai  ' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const settings = makeSettings('openai');
    const result = await callLlm('System prompt', [{ role: 'user', content: 'Hi' }], settings);

    expect(result).toBe('hello from openai');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: settings.model,
      max_tokens: 400,
      temperature: 0,
    });
  });

  it('sends max_tokens for Ollama-compatible chat requests too', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'hello from ollama' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const settings = makeSettings('ollama');
    await callLlm('System prompt', [{ role: 'user', content: 'Hi' }], settings);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: settings.model,
      max_tokens: 400,
      temperature: 0,
    });
  });

  it('throws a descriptive invalid API key error for 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({}),
    }));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings('openai')),
    ).rejects.toThrow(/invalid api key/i);
  });

  it('throws a descriptive rate limit error for 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({}),
    }));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings('openai')),
    ).rejects.toThrow(/rate limited/i);
  });

  it('throws a descriptive server error for 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    }));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings('openai')),
    ).rejects.toThrow(/server error \(500\)/i);
  });

  it('propagates timeout failures with a descriptive error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Request timed out', 'TimeoutError')));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings('ollama')),
    ).rejects.toThrow(/timed out/i);
  });

  it('throws when a provider returns an empty response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [] }),
    }));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings('openai')),
    ).rejects.toThrow(/empty response/i);
  });
});
