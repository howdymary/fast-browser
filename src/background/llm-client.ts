import type { ProviderSettings } from '../shared/types';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function callLlm(
  _systemPrompt: string,
  _messages: LlmMessage[],
  settings: ProviderSettings,
): Promise<string> {
  if (settings.provider === 'ollama') {
    throw new Error('Ollama support is planned, but the first scaffold focuses on page inspection.');
  }
  throw new Error(`Provider ${settings.provider} is not wired in this skeleton yet.`);
}

