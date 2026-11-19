import type { Domain, ExtractionCacheRecord } from '@/core/schemas';
import { hashJsonStable } from '@/core/utils/hash';
import { db, type BioBridgeDB, type EmbeddingRecord } from '../db';

export interface ExtractionCacheKeyParams {
  contentHash: string;
  extractionConfigHash: string;
  promptHash: string;
  outputLanguage: string;
}

export async function buildExtractionCacheKey(
  params: ExtractionCacheKeyParams,
): Promise<string> {
  return hashJsonStable({
    contentHash: params.contentHash,
    extractionConfigHash: params.extractionConfigHash,
    promptHash: params.promptHash,
    outputLanguage: params.outputLanguage,
  });
}

export async function getCachedExtraction(
  cacheKey: string,
  database: BioBridgeDB = db,
): Promise<ExtractionCacheRecord | undefined> {
  return database.extractionCaches.get(cacheKey);
}

export async function findLatestCacheForContentHash(
  contentHash: string,
  domain: Domain,
  database: BioBridgeDB = db,
): Promise<ExtractionCacheRecord | undefined> {
  const matches = await database.extractionCaches
    .where('contentHash')
    .equals(contentHash)
    .and((record) => record.domain === domain)
    .toArray();

  if (matches.length === 0) {
    return undefined;
  }

  matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return matches[0];
}

export async function saveExtractionCache(
  record: ExtractionCacheRecord,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.extractionCaches.put(record);
}

export async function listExtractionCaches(
  domain?: Domain,
  database: BioBridgeDB = db,
): Promise<ExtractionCacheRecord[]> {
  if (domain) {
    const records = await database.extractionCaches.where('domain').equals(domain).toArray();
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return database.extractionCaches.orderBy('createdAt').reverse().toArray();
}

export async function deleteExtractionCache(
  cacheKey: string,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.extractionCaches.delete(cacheKey);
}

export async function getEmbeddings(
  itemIds: string[],
  modelId: string,
  database: BioBridgeDB = db,
): Promise<EmbeddingRecord[]> {
  if (itemIds.length === 0) {
    return [];
  }
  const keys = itemIds.map((itemId): [string, string] => [itemId, modelId]);
  const records = await database.embeddings.bulkGet(keys);
  return records.filter((record): record is EmbeddingRecord => record !== undefined);
}

export async function saveEmbeddings(
  records: EmbeddingRecord[],
  database: BioBridgeDB = db,
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await database.embeddings.bulkPut(records);
}
