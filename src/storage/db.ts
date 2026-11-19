import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  CriticReview,
  CrossingCandidate,
  ExperimentRun,
  ExtractionCacheRecord,
  ParsedPage,
  PromptProfile,
  SourceDocument,
} from '@/core/schemas';

export interface EmbeddingRecord {
  itemId: string;
  modelId: string;
  cacheKey: string;
  vector: number[];
  createdAt: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class BioBridgeDB extends Dexie {
  documents!: EntityTable<SourceDocument, 'id'>;
  parsedPages!: Table<ParsedPage, [string, number]>;
  extractionCaches!: EntityTable<ExtractionCacheRecord, 'cacheKey'>;
  embeddings!: Table<EmbeddingRecord, [string, string]>;
  experiments!: EntityTable<ExperimentRun, 'id'>;
  candidates!: EntityTable<CrossingCandidate, 'id'>;
  reviews!: EntityTable<CriticReview, 'candidateId'>;
  promptProfiles!: EntityTable<PromptProfile, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor(dbName = 'biobridge_v1') {
    super(dbName);
    this.version(1).stores({
      documents: 'id, &contentHash, domain, createdAt',
      parsedPages: '[documentId+pageNumber], documentId',
      extractionCaches: 'cacheKey, documentId, domain, contentHash, createdAt',
      embeddings: '[itemId+modelId], cacheKey',
      experiments: 'id, status, updatedAt',
      candidates: 'id, experimentId, [experimentId+mechanismId+problemId]',
      reviews: 'candidateId, experimentId, status, weightedTotalScore',
      promptProfiles: 'id, isDefault, updatedAt',
      settings: 'key',
    });
  }
}

export function createBioBridgeDB(dbName = 'biobridge_v1'): BioBridgeDB {
  return new BioBridgeDB(dbName);
}

export const db = createBioBridgeDB('biobridge_v1');
