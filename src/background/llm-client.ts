import { getProviderEndpoint } from '../shared/settings';
import type { ProviderSettings } from '../shared/types';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

function httpErrorMessage(status: number, details: string | null): string {
  if (status === 404 && details && /model ['"].+['"] not found/i.test(details)) {
    const match = details.match(/model ['"]([^'"]+)['"] not found/i);
    const model = match?.[1] ?? 'that model';
    return `ollama: Model "${model}" is not installed locally. Run "ollama pull ${model}" and try again.`;
  }
  if (status === 404) {
    return 'ollama: Endpoint not found (404). Check the Ollama endpoint in model setup.';
  }
  if (status === 429) {
    return 'ollama: Rate limited — wait and retry.';
  }
  if (status >= 500) {
    return `ollama: Server error (${status}).`;
  }
  return `ollama: Request failed (${status})`;
}

async function readErrorDetails(response: Response): Promise<string | null> {
  const jsonSource = typeof response.clone === 'function' ? response.clone() : response;
  try {
    const data = await jsonSource.json() as {
      error?: string | { message?: string };
      message?: string;
    };
    if (typeof data.error === 'string') {
      return data.error.trim() || null;
    }
    return data.error?.message?.trim() || data.message?.trim() || null;
  } catch {
    const textSource = typeof response.clone === 'function' ? response.clone() : response;
    try {
      const text = typeof textSource.text === 'function' ? (await textSource.text()).trim() : '';
      return text || null;
    } catch {
      return null;
    }
  }
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

  try {
    const response = await fetch(getProviderEndpoint(settings), {
      method: 'POST',
      signal: combined,
      headers: {
        'content-type': 'application/json',
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
      const details = await readErrorDetails(response);
      const base = httpErrorMessage(response.status, details);
      throw new Error(details && !base.includes(details) ? `${base}: ${details}` : base);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('ollama returned an empty response.');
    }
    return text;
  } catch (error) {
    if (timeout.timedOut() && !(signal?.aborted ?? false)) {
      throw new Error(`ollama: ${timeout.error.message}`);
    }
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      throw new Error('ollama: Could not reach the local Ollama server. Make sure Ollama is running and the endpoint is correct.');
    }
    throw error;
  } finally {
    timeout.clear();
  }
}
