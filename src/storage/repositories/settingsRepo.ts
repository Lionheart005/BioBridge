import type { ModelAssignments, PromptProfile, ProviderId } from '@/core/schemas';
import { db, type BioBridgeDB } from '../db';

export type TransportMode = 'direct-byok' | 'managed-proxy';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ProviderEndpointConfig {
  provider: ProviderId;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
}

export interface PricingOverride {
  inputPer1MUsd: number;
  outputPer1MUsd: number;
  embeddingPer1MUsd?: number;
  visionPerImageUsd?: number;
}

export type PricingOverrideMap = Record<string, PricingOverride>;

export interface AppSettings {
  transportMode: TransportMode;
  managedProxyUrl?: string;
  keyStorageMode: 'local' | 'session';
  theme: ThemeMode;
  usdToEurRate: number;
  pricingOverrides: PricingOverrideMap;
  providerEndpoints?: Partial<Record<ProviderId, ProviderEndpointConfig>>;
  defaultModelAssignments: ModelAssignments;
  defaultOutputLanguage: string;
}

export const APP_SETTINGS_KEY = 'app_settings';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  transportMode: 'direct-byok',
  keyStorageMode: 'session',
  theme: 'light',
  usdToEurRate: 0.92,
  pricingOverrides: {},
  defaultModelAssignments: {
    extraction: { provider: 'gemini', modelId: 'gemini-4-hydrogen', temperature: 0.1, reasoningEffort: 'low' },
    vision: { provider: 'gemini', modelId: 'gemini-4-hydrogen', temperature: 0.1, reasoningEffort: 'low' },
    embedding: { provider: 'gemini', modelId: 'text-embedding-004' },
    crossing: { provider: 'gemini', modelId: 'gemini-4-neon', temperature: 0.4, reasoningEffort: 'medium' },
    critic: { provider: 'anthropic', modelId: 'claude-sonnet-5-5', temperature: 0.1, reasoningEffort: 'high' },
  },
  defaultOutputLanguage: 'de',
};

export async function getSetting<T>(
  key: string,
  defaultValue: T,
  database: BioBridgeDB = db,
): Promise<T> {
  const record = await database.settings.get(key);
  if (!record) {
    return defaultValue;
  }
  return record.value as T;
}

export async function setSetting<T>(
  key: string,
  value: T,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.settings.put({
    key,
    value,
    updatedAt: new Date().toISOString(),
  });
}

export async function getAppSettings(database: BioBridgeDB = db): Promise<AppSettings> {
  const stored = await getSetting<Partial<AppSettings>>(
    APP_SETTINGS_KEY,
    {},
    database,
  );
  return {
    ...DEFAULT_APP_SETTINGS,
    ...stored,
    pricingOverrides: {
      ...DEFAULT_APP_SETTINGS.pricingOverrides,
      ...(stored.pricingOverrides ?? {}),
    },
    defaultModelAssignments: {
      ...DEFAULT_APP_SETTINGS.defaultModelAssignments,
      ...(stored.defaultModelAssignments ?? {}),
    },
  };
}

export async function saveAppSettings(
  patch: Partial<AppSettings>,
  database: BioBridgeDB = db,
): Promise<AppSettings> {
  const current = await getAppSettings(database);
  const next: AppSettings = {
    ...current,
    ...patch,
    pricingOverrides: patch.pricingOverrides
      ? { ...current.pricingOverrides, ...patch.pricingOverrides }
      : current.pricingOverrides,
    defaultModelAssignments: patch.defaultModelAssignments
      ? { ...current.defaultModelAssignments, ...patch.defaultModelAssignments }
      : current.defaultModelAssignments,
  };
  await setSetting(APP_SETTINGS_KEY, next, database);
  return next;
}

export async function listPromptProfiles(
  database: BioBridgeDB = db,
): Promise<PromptProfile[]> {
  return database.promptProfiles.orderBy('updatedAt').reverse().toArray();
}

export async function getPromptProfile(
  id: string,
  database: BioBridgeDB = db,
): Promise<PromptProfile | undefined> {
  return database.promptProfiles.get(id);
}

export async function savePromptProfile(
  profile: PromptProfile,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.promptProfiles.put(profile);
}

export async function deletePromptProfile(
  id: string,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.promptProfiles.delete(id);
}
