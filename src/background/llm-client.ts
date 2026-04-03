import { getProviderEndpoint } from '../shared/settings';
import type { ProviderSettings } from '../shared/types';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

const REQUEST_TIMEOUT_MS = 30_000;
const ANTHROPIC_API_VERSION = '2023-06-01';

function httpErrorMessage(provider: ProviderSettings['provider'], status: number): string {
  if (status === 401) {
    return `${provider}: Invalid API key`;
  }
  if (status === 429) {
    return `${provider}: Rate limited — wait and retry`;
  }
  if (status >= 500) {
    return `${provider}: Server error (${status})`;
  }
  return `${provider}: Request failed (${status})`;
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
  error: Error;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let didTimeOut = false;
  const error = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
  const timeoutId = setTimeout(() => {
    didTimeOut = true;
    controller.abort(error);
  }, timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
    error,
    timedOut: () => didTimeOut,
  };
}

export async function callLlm(
  systemPrompt: string,
  messages: LlmMessage[],
  settings: ProviderSettings,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = createTimeoutSignal(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

  if (settings.provider === 'anthropic') {
    try {
      const response = await fetch(getProviderEndpoint(settings), {
        method: 'POST',
        signal: combined,
        headers: {
          'content-type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify({
          model: settings.model,
          max_tokens: 400,
          system: systemPrompt,
          messages: messages.map((message) => ({ role: message.role, content: message.content })),
        }),
      });

      if (!response.ok) {
        throw new Error(httpErrorMessage(settings.provider, response.status));
      }

      const data = await response.json() as {
        content?: Array<{ text?: string }>;
      };
      const text = data.content?.[0]?.text?.trim();
      if (!text) {
        throw new Error('Anthropic returned an empty response.');
      }
      return text;
    } catch (error) {
      if (timeout.timedOut() && !(signal?.aborted ?? false)) {
        throw new Error(`anthropic: ${timeout.error.message}`);
      }
      throw error;
    } finally {
      timeout.clear();
    }
  }

  try {
    const response = await fetch(getProviderEndpoint(settings), {
      method: 'POST',
      signal: combined,
      headers: {
        'content-type': 'application/json',
        ...(settings.provider === 'ollama' ? {} : { authorization: `Bearer ${settings.apiKey}` }),
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(httpErrorMessage(settings.provider, response.status));
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error(`${settings.provider} returned an empty response.`);
    }
    return text;
  } catch (error) {
    if (timeout.timedOut() && !(signal?.aborted ?? false)) {
      throw new Error(`${settings.provider}: ${timeout.error.message}`);
    }
    throw error;
  } finally {
    timeout.clear();
  }
}
