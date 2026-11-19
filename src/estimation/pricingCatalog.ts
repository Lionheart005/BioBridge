import type { ModelAssignments, ProviderId } from '@/core/schemas';

export const PRICING_CATALOG_UPDATED_AT = '2026-11-19';
export const DEFAULT_USD_TO_EUR_RATE = 0.92;

export interface ModelPricing {
  provider: ProviderId;
  modelId: string;
  displayName: string;
  inputPer1MUsd: number;
  outputPer1MUsd: number;
  embeddingPer1MUsd?: number;
  visionPerImageUsd?: number;
  supportsVision?: boolean;
  supportsEmbeddings?: boolean;
}

export type PricingOverrideEntry = Partial<
  Pick<
    ModelPricing,
    | 'inputPer1MUsd'
    | 'outputPer1MUsd'
    | 'embeddingPer1MUsd'
    | 'visionPerImageUsd'
  >
>;

export type PricingOverrideMap = Record<string, PricingOverrideEntry>;

export const DEFAULT_MODEL_PRICING_CATALOG: ModelPricing[] = [
  // Google Gemini
  {
    provider: 'gemini',
    modelId: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen',
    inputPer1MUsd: 1.5,
    outputPer1MUsd: 7.5,
    visionPerImageUsd: 0.0012,
    supportsVision: true,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-4-neon',
    displayName: 'Gemini 4 Neon',
    inputPer1MUsd: 3.0,
    outputPer1MUsd: 15.0,
    visionPerImageUsd: 0.0024,
    supportsVision: true,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-4-argon',
    displayName: 'Gemini 4 Argon',
    inputPer1MUsd: 2.0,
    outputPer1MUsd: 10.0,
    visionPerImageUsd: 0.0018,
    supportsVision: true,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    inputPer1MUsd: 0.75,
    outputPer1MUsd: 3.75,
    visionPerImageUsd: 0.0006,
    supportsVision: true,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash-Lite',
    inputPer1MUsd: 0.3,
    outputPer1MUsd: 2.5,
    visionPerImageUsd: 0.0003,
    supportsVision: true,
  },
  {
    provider: 'gemini',
    modelId: 'text-embedding-004',
    displayName: 'Gemini Text Embedding 004',
    inputPer1MUsd: 0.025,
    outputPer1MUsd: 0,
    embeddingPer1MUsd: 0.025,
    supportsEmbeddings: true,
  },
  // Legacy Google Gemini
  {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    inputPer1MUsd: 0.15,
    outputPer1MUsd: 0.6,
    visionPerImageUsd: 0.0002,
    supportsVision: true,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    inputPer1MUsd: 1.25,
    outputPer1MUsd: 10.0,
    visionPerImageUsd: 0.0014,
    supportsVision: true,
  },

  // Anthropic
  {
    provider: 'anthropic',
    modelId: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    inputPer1MUsd: 4.0,
    outputPer1MUsd: 20.0,
    visionPerImageUsd: 0.004,
    supportsVision: true,
  },
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    displayName: 'Claude Sonnet 5.5',
    inputPer1MUsd: 2.0,
    outputPer1MUsd: 10.0,
    visionPerImageUsd: 0.0024,
    supportsVision: true,
  },
  {
    provider: 'anthropic',
    modelId: 'claude-haiku-5-5',
    displayName: 'Claude Haiku 5.5',
    inputPer1MUsd: 0.1,
    outputPer1MUsd: 0.5,
    visionPerImageUsd: 0.0004,
    supportsVision: true,
  },
  // Legacy Anthropic
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-haiku-latest',
    displayName: 'Claude 3.5 Haiku',
    inputPer1MUsd: 0.8,
    outputPer1MUsd: 4.0,
    visionPerImageUsd: 0.001,
    supportsVision: true,
  },
  {
    provider: 'anthropic',
    modelId: 'claude-3-7-sonnet-latest',
    displayName: 'Claude 3.7 Sonnet',
    inputPer1MUsd: 3.0,
    outputPer1MUsd: 15.0,
    visionPerImageUsd: 0.0036,
    supportsVision: true,
  },

  // DeepSeek (konservativer Peak-Tarif; Off-Peak 50 % günstiger)
  {
    provider: 'deepseek',
    modelId: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    inputPer1MUsd: 1.32,
    outputPer1MUsd: 3.96,
    supportsVision: false,
  },
  {
    provider: 'deepseek',
    modelId: 'deepseek-flash',
    displayName: 'DeepSeek V4.1 Flash',
    inputPer1MUsd: 0.3,
    outputPer1MUsd: 1.2,
    supportsVision: false,
  },

  // OpenAI
  {
    provider: 'openai',
    modelId: 'gpt-6-luna',
    displayName: 'GPT-6 Luna',
    inputPer1MUsd: 0.1,
    outputPer1MUsd: 0.5,
    visionPerImageUsd: 0.0003,
    supportsVision: true,
  },
  {
    provider: 'openai',
    modelId: 'gpt-6.2-sol',
    displayName: 'GPT-6.2 Sol',
    inputPer1MUsd: 2.0,
    outputPer1MUsd: 10.0,
    visionPerImageUsd: 0.0022,
    supportsVision: true,
  },
  {
    provider: 'openai',
    modelId: 'gpt-6.2-astra',
    displayName: 'GPT-6.2 Astra',
    inputPer1MUsd: 8.0,
    outputPer1MUsd: 40.0,
    visionPerImageUsd: 0.005,
    supportsVision: true,
  },
  {
    provider: 'openai',
    modelId: 'o4-mini',
    displayName: 'OpenAI o4-mini',
    inputPer1MUsd: 1.1,
    outputPer1MUsd: 4.4,
    supportsVision: true,
  },
  {
    provider: 'openai',
    modelId: 'text-embedding-3-small',
    displayName: 'OpenAI Text Embedding 3 Small',
    inputPer1MUsd: 0.02,
    outputPer1MUsd: 0,
    embeddingPer1MUsd: 0.02,
    supportsEmbeddings: true,
  },
  // Legacy OpenAI
  {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    inputPer1MUsd: 0.15,
    outputPer1MUsd: 0.6,
    visionPerImageUsd: 0.0004,
    supportsVision: true,
  },
  {
    provider: 'openai',
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    inputPer1MUsd: 2.5,
    outputPer1MUsd: 10.0,
    visionPerImageUsd: 0.0028,
    supportsVision: true,
  },
  {
    provider: 'openai',
    modelId: 'o3-mini',
    displayName: 'OpenAI o3-mini',
    inputPer1MUsd: 1.1,
    outputPer1MUsd: 4.4,
    supportsVision: false,
  },

  // OpenRouter common mappings
  {
    provider: 'openrouter',
    modelId: 'google/gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen (OpenRouter)',
    inputPer1MUsd: 1.5,
    outputPer1MUsd: 7.5,
    visionPerImageUsd: 0.0012,
    supportsVision: true,
  },
  {
    provider: 'openrouter',
    modelId: 'google/gemini-4-neon',
    displayName: 'Gemini 4 Neon (OpenRouter)',
    inputPer1MUsd: 3.0,
    outputPer1MUsd: 15.0,
    visionPerImageUsd: 0.0024,
    supportsVision: true,
  },
  {
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-5-5',
    displayName: 'Claude Sonnet 5.5 (OpenRouter)',
    inputPer1MUsd: 2.0,
    outputPer1MUsd: 10.0,
    visionPerImageUsd: 0.0024,
    supportsVision: true,
  },
  {
    provider: 'openrouter',
    modelId: 'anthropic/claude-opus-5-5',
    displayName: 'Claude Opus 5.5 (OpenRouter)',
    inputPer1MUsd: 4.0,
    outputPer1MUsd: 20.0,
    visionPerImageUsd: 0.004,
    supportsVision: true,
  },
  {
    provider: 'openrouter',
    modelId: 'deepseek/deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro (OpenRouter)',
    inputPer1MUsd: 1.32,
    outputPer1MUsd: 3.96,
    supportsVision: false,
  },
  {
    provider: 'openrouter',
    modelId: 'deepseek/deepseek-flash',
    displayName: 'DeepSeek V4.1 Flash (OpenRouter)',
    inputPer1MUsd: 0.3,
    outputPer1MUsd: 1.2,
    supportsVision: false,
  },
  {
    provider: 'openrouter',
    modelId: 'openai/gpt-6.2-sol',
    displayName: 'GPT-6.2 Sol (OpenRouter)',
    inputPer1MUsd: 2.0,
    outputPer1MUsd: 10.0,
    visionPerImageUsd: 0.0022,
    supportsVision: true,
  },
  {
    provider: 'openrouter',
    modelId: 'openai/gpt-6-luna',
    displayName: 'GPT-6 Luna (OpenRouter)',
    inputPer1MUsd: 0.1,
    outputPer1MUsd: 0.5,
    visionPerImageUsd: 0.0003,
    supportsVision: true,
  },
  // Legacy OpenRouter
  {
    provider: 'openrouter',
    modelId: 'google/gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash (OpenRouter)',
    inputPer1MUsd: 0.15,
    outputPer1MUsd: 0.6,
    visionPerImageUsd: 0.0002,
    supportsVision: true,
  },
  {
    provider: 'openrouter',
    modelId: 'openai/gpt-4o-mini',
    displayName: 'GPT-4o mini (OpenRouter)',
    inputPer1MUsd: 0.15,
    outputPer1MUsd: 0.6,
    visionPerImageUsd: 0.0004,
    supportsVision: true,
  },
  {
    provider: 'openrouter',
    modelId: 'anthropic/claude-3.7-sonnet',
    displayName: 'Claude 3.7 Sonnet (OpenRouter)',
    inputPer1MUsd: 3.0,
    outputPer1MUsd: 15.0,
    visionPerImageUsd: 0.0036,
    supportsVision: true,
  },

  // Custom / Local Ollama
  {
    provider: 'custom',
    modelId: 'llama3.1',
    displayName: 'Lokales Modell (Ollama / Custom)',
    inputPer1MUsd: 0,
    outputPer1MUsd: 0,
    embeddingPer1MUsd: 0,
    visionPerImageUsd: 0,
    supportsVision: true,
    supportsEmbeddings: true,
  },
];

export type ModelPresetId = 'economical' | 'balanced' | 'deep-cross-model';

export interface ModelPreset {
  id: ModelPresetId;
  label: string;
  description: string;
  assignments: ModelAssignments;
}

export const MODEL_PRESETS: Record<ModelPresetId, ModelPreset> = {
  economical: {
    id: 'economical',
    label: 'Sparsam',
    description:
      'Minimale Kosten für große Sachbücher und erste Explorationen (Gemini 3.5 Flash-Lite + Gemini 4 Hydrogen + Text-Embedding-004).',
    assignments: {
      extraction: { provider: 'gemini', modelId: 'gemini-3.5-flash-lite', temperature: 0.1, reasoningEffort: 'low' },
      vision: { provider: 'gemini', modelId: 'gemini-3.5-flash-lite', temperature: 0.1, reasoningEffort: 'low' },
      embedding: { provider: 'gemini', modelId: 'text-embedding-004' },
      crossing: { provider: 'gemini', modelId: 'gemini-4-hydrogen', temperature: 0.4, reasoningEffort: 'low' },
      critic: { provider: 'gemini', modelId: 'gemini-4-hydrogen', temperature: 0.1, reasoningEffort: 'low' },
    },
  },
  balanced: {
    id: 'balanced',
    label: 'Ausgewogen',
    description:
      'Schnelle Extraktion mit Gemini 4 Hydrogen, starkes Reasoning mit Gemini 4 Neon und strenger Advocatus Diaboli mit Claude Sonnet 5.5.',
    assignments: {
      extraction: { provider: 'gemini', modelId: 'gemini-4-hydrogen', temperature: 0.1, reasoningEffort: 'low' },
      vision: { provider: 'gemini', modelId: 'gemini-4-hydrogen', temperature: 0.1, reasoningEffort: 'low' },
      embedding: { provider: 'gemini', modelId: 'text-embedding-004' },
      crossing: { provider: 'gemini', modelId: 'gemini-4-neon', temperature: 0.4, reasoningEffort: 'medium' },
      critic: { provider: 'anthropic', modelId: 'claude-sonnet-5-5', temperature: 0.1, reasoningEffort: 'high' },
    },
  },
  'deep-cross-model': {
    id: 'deep-cross-model',
    label: 'Maximale Tiefe / Cross-Model',
    description:
      'Verschiedene Modellfamilien für Ideengeber (Gemini 4 Hydrogen/Neon) und Gutachter (Claude Opus 5.5) zur Minimierung von Eigenbias.',
    assignments: {
      extraction: { provider: 'gemini', modelId: 'gemini-4-hydrogen', temperature: 0.1, reasoningEffort: 'medium' },
      vision: { provider: 'gemini', modelId: 'gemini-4-neon', temperature: 0.1, reasoningEffort: 'medium' },
      embedding: { provider: 'openai', modelId: 'text-embedding-3-small' },
      crossing: { provider: 'gemini', modelId: 'gemini-4-neon', temperature: 0.5, reasoningEffort: 'high' },
      critic: { provider: 'anthropic', modelId: 'claude-opus-5-5', temperature: 0.1, reasoningEffort: 'extreme' },
    },
  },
};

function getProviderFallbackPricing(
  provider: ProviderId,
  modelId: string,
): ModelPricing {
  if (provider === 'custom') {
    return {
      provider,
      modelId,
      displayName: `${modelId} (Custom / Lokal)`,
      inputPer1MUsd: 0,
      outputPer1MUsd: 0,
      embeddingPer1MUsd: 0,
      visionPerImageUsd: 0,
    };
  }

  const sameProvider = DEFAULT_MODEL_PRICING_CATALOG.find(
    (entry) => entry.provider === provider,
  );
  if (sameProvider) {
    return {
      ...sameProvider,
      modelId,
      displayName: modelId,
    };
  }

  return {
    provider,
    modelId,
    displayName: modelId,
    inputPer1MUsd: 0.5,
    outputPer1MUsd: 2.0,
    embeddingPer1MUsd: 0.05,
    visionPerImageUsd: 0.001,
  };
}

export function getModelPricing(
  provider: ProviderId,
  modelId: string,
  overrides?: PricingOverrideMap,
): ModelPricing {
  const exact = DEFAULT_MODEL_PRICING_CATALOG.find(
    (entry) => entry.provider === provider && entry.modelId === modelId,
  );
  const partial =
    exact ??
    DEFAULT_MODEL_PRICING_CATALOG.find(
      (entry) =>
        entry.provider === provider &&
        (modelId.includes(entry.modelId) || entry.modelId.includes(modelId)),
    );

  const base = partial
    ? { ...partial, modelId }
    : getProviderFallbackPricing(provider, modelId);

  if (!overrides) {
    return base;
  }

  const override =
    overrides[`${provider}:${modelId}`] ?? overrides[modelId];
  if (!override) {
    return base;
  }

  return {
    ...base,
    ...override,
  };
}
