import {
  BioBridgeProjectBundleSchema,
  type BioBridgeProjectBundle,
  type CrossingCandidate,
  type CriticReview,
  type ExperimentRun,
  type ExtractedMechanism,
  type ExtractedProblem,
  type ExtractionCacheRecord,
  type ParsedPage,
  type SourceDocument,
} from '@/core/schemas';
import { hashJsonStable } from '@/core/utils/hash';
import { db, type BioBridgeDB } from '../db';
import { putPagesInBatches } from '../repositories/documentRepo';
import { buildExtractionCacheKey } from '../repositories/extractionCacheRepo';

export interface ExportProjectBundleInput {
  experiment: ExperimentRun;
  documents: SourceDocument[];
  parsedPages: ParsedPage[];
  mechanisms: ExtractedMechanism[];
  problems: ExtractedProblem[];
  candidates: CrossingCandidate[];
  reviews: CriticReview[];
  exportedAt?: string;
}

export interface ImportProjectBundleResult {
  experimentId: string;
  importedDocuments: number;
  importedCandidates: number;
  importedReviews: number;
}

export function exportProjectBundle(
  input: ExportProjectBundleInput,
): BioBridgeProjectBundle {
  return BioBridgeProjectBundleSchema.parse({
    schemaVersion: '1.0.0',
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    experiment: input.experiment,
    documents: input.documents,
    parsedPages: input.parsedPages,
    mechanisms: input.mechanisms,
    problems: input.problems,
    candidates: input.candidates,
    reviews: input.reviews,
  });
}

export function serializeProjectBundle(bundle: BioBridgeProjectBundle): string {
  const validated = BioBridgeProjectBundleSchema.parse(bundle);
  return JSON.stringify(validated, null, 2);
}

export function parseProjectBundle(jsonText: string): BioBridgeProjectBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid BioBridge project bundle JSON: ${message}`);
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid BioBridge project bundle: root value must be a JSON object.');
  }

  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== '1.0.0') {
    throw new Error(
      `Unsupported BioBridge project bundle schemaVersion: "${String(record.schemaVersion)}". Expected "1.0.0".`,
    );
  }

  const result = BioBridgeProjectBundleSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid BioBridge project bundle structure: ${issues}`);
  }

  return result.data;
}

async function prepareExtractionCacheRecords(
  bundle: BioBridgeProjectBundle,
): Promise<ExtractionCacheRecord[]> {
  if (bundle.documents.length === 0) {
    return [];
  }

  const extractionConfigHash = await hashJsonStable({
    extractionModel: bundle.experiment.config.modelAssignments.extraction,
    visionModel: bundle.experiment.config.modelAssignments.vision,
    includeDiagrams: bundle.experiment.config.includeDiagrams,
    pdfMathVisionMode: bundle.experiment.config.pdfMathVisionMode,
  });

  const promptHash = await hashJsonStable(bundle.experiment.config.promptProfileSnapshot);
  const outputLanguage = bundle.experiment.config.outputLanguage;
  const records: ExtractionCacheRecord[] = [];

  for (const doc of bundle.documents) {
    const docMechanisms =
      doc.domain === 'biology'
        ? bundle.mechanisms.filter((m) => m.sourceDocumentIds.includes(doc.id))
        : [];
    const docProblems =
      doc.domain === 'technology'
        ? bundle.problems.filter((p) => p.sourceDocumentIds.includes(doc.id))
        : [];

    if (docMechanisms.length === 0 && docProblems.length === 0) {
      continue;
    }

    const cacheKey = await buildExtractionCacheKey({
      contentHash: doc.contentHash,
      extractionConfigHash,
      promptHash,
      outputLanguage,
    });

    records.push({
      cacheKey,
      documentId: doc.id,
      domain: doc.domain,
      contentHash: doc.contentHash,
      extractionConfigHash,
      promptHash,
      outputLanguage,
      ...(doc.domain === 'biology' ? { mechanisms: docMechanisms } : {}),
      ...(doc.domain === 'technology' ? { problems: docProblems } : {}),
      createdAt: bundle.exportedAt,
    });
  }

  return records;
}

export async function importProjectBundleIntoDb(
  bundle: BioBridgeProjectBundle,
  database: BioBridgeDB = db,
): Promise<ImportProjectBundleResult> {
  const validated = BioBridgeProjectBundleSchema.parse(bundle);
  const cacheRecords = await prepareExtractionCacheRecords(validated);

  await database.transaction(
    'rw',
    [
      database.documents,
      database.parsedPages,
      database.extractionCaches,
      database.experiments,
      database.candidates,
      database.reviews,
    ],
    async () => {
      if (validated.documents.length > 0) {
        await database.documents.bulkPut(validated.documents);
      }

      if (validated.parsedPages.length > 0) {
        await putPagesInBatches(validated.parsedPages, database);
      }

      for (const cacheRecord of cacheRecords) {
        const existingCache = await database.extractionCaches.get(cacheRecord.cacheKey);
        if (!existingCache) {
          await database.extractionCaches.put(cacheRecord);
        }
      }

      await database.experiments.put(validated.experiment);

      if (validated.candidates.length > 0) {
        await database.candidates.bulkPut(validated.candidates);
      }

      if (validated.reviews.length > 0) {
        await database.reviews.bulkPut(validated.reviews);
      }
    },
  );

  return {
    experimentId: validated.experiment.id,
    importedDocuments: validated.documents.length,
    importedCandidates: validated.candidates.length,
    importedReviews: validated.reviews.length,
  };
}
