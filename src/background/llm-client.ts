import { getProviderEndpoint } from '../shared/settings';
import type { ProviderSettings } from '../shared/types';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

function httpErrorMessage(status: number): string {
  if (status === 401) return 'Invalid API key';
  if (status === 429) return 'Rate limited — wait and retry';
  if (status >= 500) return `Server error (${status})`;
  return `Request failed (${status})`;
}

export async function callLlm(
  systemPrompt: string,
  messages: LlmMessage[],
  settings: ProviderSettings,
  signal?: AbortSignal,
): Promise<string> {
  const timeoutMs = 30_000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  if (settings.provider === 'anthropic') {
    const response = await fetch(getProviderEndpoint(settings), {
      method: 'POST',
      signal: combined,
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 400,
        system: systemPrompt,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
      }),
    });

    if (!response.ok) {
      throw new Error(httpErrorMessage(response.status));
    }

    const data = await response.json() as {
      content?: Array<{ text?: string }>;
    };
    const text = data.content?.[0]?.text?.trim();
    if (!text) {
      throw new Error('Anthropic returned an empty response.');
    }
    return text;
  }

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
    throw new Error(httpErrorMessage(response.status));
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`${settings.provider} returned an empty response.`);
  }
  return text;
}
