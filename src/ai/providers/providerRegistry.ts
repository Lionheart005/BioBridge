import type { ProviderId } from '@/core/schemas';
import type { IAIProviderAdapter } from '@/ai/types';
import { AnthropicProviderAdapter } from './anthropicAdapter';
import { GeminiProviderAdapter } from './geminiAdapter';
import { OpenAICompatibleAdapter } from './openaiAdapter';

const ADAPTERS: Record<ProviderId, IAIProviderAdapter> = {
  gemini: new GeminiProviderAdapter(),
  openai: new OpenAICompatibleAdapter('openai'),
  deepseek: new OpenAICompatibleAdapter('deepseek'),
  openrouter: new OpenAICompatibleAdapter('openrouter'),
  custom: new OpenAICompatibleAdapter('custom'),
  anthropic: new AnthropicProviderAdapter(),
};

export function getProviderAdapter(providerId: ProviderId): IAIProviderAdapter {
  const adapter = ADAPTERS[providerId];
  if (!adapter) {
    throw new Error(`Unsupported AI provider: ${String(providerId)}`);
  }
  return adapter;
}

export function listRegisteredProviders(): ProviderId[] {
  return Object.keys(ADAPTERS) as ProviderId[];
}
