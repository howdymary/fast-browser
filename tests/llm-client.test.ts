import { afterEach, describe, expect, it, vi } from 'vitest';

import { callLlm } from '../src/background/llm-client';
import { OLLAMA_DEFAULT_ENDPOINT } from '../src/shared/settings';
import type { ProviderSettings } from '../src/shared/types';

function makeSettings(model = 'llama3.2:3b'): ProviderSettings {
  return {
    provider: 'ollama',
    model,
    baseUrl: OLLAMA_DEFAULT_ENDPOINT,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('callLlm', () => {
  it('returns Ollama chat completions content and sends max_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'hello from ollama' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings());

    expect(result).toBe('hello from ollama');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: 'llama3.2:3b',
      max_tokens: 400,
      temperature: 0,
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hi' },
      ],
    });
  });

  it('throws a helpful model install error when Ollama reports model not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({
        error: { message: "model 'qwen2.5:7b' not found" },
      }),
    }));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings('qwen2.5:7b')),
    ).rejects.toThrow(/ollama pull qwen2\.5:7b/i);
  });

  it('throws a descriptive rate limit error for 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({}),
    }));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings()),
    ).rejects.toThrow(/rate limited/i);
  });

  it('throws a descriptive server error for 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    }));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings()),
    ).rejects.toThrow(/server error/i);
  });

  it('surfaces fetch failures with a local Ollama help message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings()),
    ).rejects.toThrow(/could not reach the local ollama server/i);
  });

  it('propagates timeout failures with a descriptive error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Request timed out', 'TimeoutError')));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings()),
    ).rejects.toThrow(/timed out/i);
  });

  it('throws when Ollama returns an empty response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [] }),
    }));

    await expect(
      callLlm('System prompt', [{ role: 'user', content: 'Hi' }], makeSettings()),
    ).rejects.toThrow(/empty response/i);
  });
});
