import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CrossingCandidate,
  CriticReview,
  ExperimentRun,
  ExtractionCacheRecord,
  ParsedPage,
  PromptProfile,
  PromptSlotId,
  SourceDocument,
} from '@/core/schemas';
import {
  buildExtractionCacheKey,
  createBioBridgeDB,
  deleteDocumentCascade,
  deleteExperimentCascade,
  deleteExtractionCache,
  deletePromptProfile,
  findLatestCacheForContentHash,
  getAppSettings,
  getCachedExtraction,
  getCandidatesForExperiment,
  getDocumentByHash,
  getDocumentById,
  getEmbeddings,
  getExperiment,
  getPageRange,
  getPagesForDocument,
  getPromptProfile,
  getReviewsForExperiment,
  getSetting,
  listDocuments,
  listExperiments,
  listExtractionCaches,
  listPromptProfiles,
  saveAppSettings,
  saveCandidates,
  saveDocumentWithPages,
  saveEmbeddings,
  saveExperiment,
  saveExtractionCache,
  savePromptProfile,
  saveReviews,
  setSetting,
  updateCheckpoint,
  updateParsedPage,
  type BioBridgeDB,
} from '@/storage';

function makePromptProfile(id = 'profile-default'): PromptProfile {
  const slot = (slotId: PromptSlotId) => ({
    id: slotId,
    title: `Title ${slotId}`,
    description: `Desc ${slotId}`,
    phase: 'phase2',
    riskHint: 'Low',
    editableSystemInstruction: 'Analyze carefully.',
    lockedOutputContract: '{"type":"object"}',
    requiredVariables: ['text'],
  });
  return {
    id,
    name: 'Default Profile',
    isDefault: true,
    slots: {
      extractBio: slot('extractBio'),
      extractTech: slot('extractTech'),
      visionExtract: slot('visionExtract'),
      consolidate: slot('consolidate'),
      crossing: slot('crossing'),
      cluster: slot('cluster'),
      critic: slot('critic'),
      citationRepair: slot('citationRepair'),
    },
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
  };
}

function makeDocument(
  id: string,
  domain: 'biology' | 'technology' = 'biology',
  contentHash = `hash-${id}`,
  pageCount = 1,
): SourceDocument {
  return {
    id,
    domain,
    fileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    format: 'pdf',
    contentHash,
    fileSizeBytes: 1024,
    pageCount,
    detectedLanguage: 'en',
    stats: {
      totalChars: pageCount * 200,
      estimatedTokens: pageCount * 50,
      detectedFigurePages: [],
      detectedMathAnomalyPages: [],
    },
    createdAt: '2026-11-19T10:00:00.000Z',
  };
}

function makePages(documentId: string, count: number): ParsedPage[] {
  return Array.from({ length: count }, (_, idx) => {
    const pageNumber = idx + 1;
    return {
      documentId,
      pageNumber,
      sectionPath: ['Section 1'],
      rawNormalizedText: `Normalized text for page ${pageNumber}`,
      blocks: [
        {
          id: `block-${documentId}-${pageNumber}`,
          type: 'paragraph',
          content: `Content on page ${pageNumber}`,
        },
      ],
    };
  });
}

function makeExperiment(id: string, updatedAt = '2026-11-19T10:00:00.000Z'): ExperimentRun {
  return {
    id,
    name: `Experiment ${id}`,
    createdAt: '2026-11-19T09:00:00.000Z',
    updatedAt,
    status: 'DRAFT',
    biologyDocIds: ['doc-bio-1'],
    technologyDocIds: ['doc-tech-1'],
    config: {
      outputLanguage: 'de',
      crossingStrategy: 'embedding-hybrid',
      creativityDistance: 0.6,
      distanceBand: 'balanced',
      maxCandidates: 10,
      includeDiagrams: true,
      pdfMathVisionMode: 'auto',
      modelAssignments: {
        extraction: { provider: 'gemini', modelId: 'gemini-2.5-flash' },
        vision: { provider: 'gemini', modelId: 'gemini-2.5-flash' },
        embedding: { provider: 'openai', modelId: 'text-embedding-3-small' },
        crossing: { provider: 'gemini', modelId: 'gemini-2.5-pro' },
        critic: { provider: 'openai', modelId: 'gpt-4o' },
      },
      weights: {
        mechanismDepth: 1,
        scalabilityAndConstraints: 1,
        technicalValue: 1,
        novelty: 1,
      },
      promptProfileSnapshot: makePromptProfile(),
    },
    checkpoint: {
      currentPhase: 'idle',
      completedVisionPageKeys: [],
      completedChunkKeys: [],
      completedPairKeys: [],
      completedReviewKeys: [],
    },
    costLedger: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalVisionImages: 0,
      totalCostUsd: 0,
      entries: [],
    },
  };
}

describe('storage layer (Dexie + fake-indexeddb)', () => {
  let testDb: BioBridgeDB;
  let dbCounter = 0;

  beforeEach(() => {
    dbCounter += 1;
    testDb = createBioBridgeDB(`biobridge_test_${Date.now()}_${dbCounter}`);
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('saves a 200-page document in batches of 75, retrieves sorted pages, ranges, and updates pages', async () => {
    const doc = makeDocument('doc-200', 'biology', 'sha256-200', 200);
    const pages = makePages('doc-200', 200);
    // Reverse order to verify getPagesForDocument sorts ascending
    const reversedPages = [...pages].reverse();
    const bulkPutSpy = vi.spyOn(testDb.parsedPages, 'bulkPut');

    await saveDocumentWithPages(doc, reversedPages, testDb);

    // 200 pages with batch size 75 => 3 calls (75, 75, 50)
    expect(bulkPutSpy).toHaveBeenCalledTimes(3);
    expect(bulkPutSpy.mock.calls[0][0]).toHaveLength(75);
    expect(bulkPutSpy.mock.calls[1][0]).toHaveLength(75);
    expect(bulkPutSpy.mock.calls[2][0]).toHaveLength(50);

    const fetchedDoc = await getDocumentById('doc-200', testDb);
    expect(fetchedDoc?.fileName).toBe('doc-200.pdf');

    const allPages = await getPagesForDocument('doc-200', testDb);
    expect(allPages).toHaveLength(200);
    expect(allPages[0].pageNumber).toBe(1);
    expect(allPages[199].pageNumber).toBe(200);

    const range = await getPageRange('doc-200', 10, 15, testDb);
    expect(range.map((p) => p.pageNumber)).toEqual([10, 11, 12, 13, 14, 15]);

    const updatedPage: ParsedPage = {
      ...range[0],
      hasDiagram: true,
      blocks: [
        ...range[0].blocks,
        { id: 'vision-1', type: 'figure_vision', content: 'Diagram description' },
      ],
    };
    await updateParsedPage(updatedPage, testDb);
    const reloadedRange = await getPageRange('doc-200', 10, 10, testDb);
    expect(reloadedRange[0].hasDiagram).toBe(true);
    expect(reloadedRange[0].blocks).toHaveLength(2);
  });

  it('deduplicates documents by contentHash and cascades deletes cleanly', async () => {
    const doc1 = makeDocument('doc-a', 'biology', 'same-hash', 2);
    const pages1 = makePages('doc-a', 2);
    const saved1 = await saveDocumentWithPages(doc1, pages1, testDb);
    expect(saved1.id).toBe('doc-a');

    // Second save with different ID but same contentHash should deduplicate without ConstraintError
    const doc2 = makeDocument('doc-b', 'biology', 'same-hash', 2);
    const pages2 = makePages('doc-b', 2);
    const saved2 = await saveDocumentWithPages(doc2, pages2, testDb);
    expect(saved2.id).toBe('doc-a');

    const docs = await listDocuments('biology', testDb);
    expect(docs).toHaveLength(1);
    expect((await getDocumentByHash('same-hash', testDb))?.id).toBe('doc-a');

    await saveExtractionCache(
      {
        cacheKey: 'cache-doc-a',
        documentId: 'doc-a',
        domain: 'biology',
        contentHash: 'same-hash',
        extractionConfigHash: 'cfg-1',
        promptHash: 'prompt-1',
        outputLanguage: 'de',
        mechanisms: [],
        createdAt: '2026-11-19T10:00:00.000Z',
      },
      testDb,
    );

    await deleteDocumentCascade('doc-a', testDb);
    expect(await getDocumentById('doc-a', testDb)).toBeUndefined();
    expect(await getPagesForDocument('doc-a', testDb)).toHaveLength(0);
    expect(await getCachedExtraction('cache-doc-a', testDb)).toBeUndefined();
  });

  it('handles extraction cache hit/miss on promptHash or outputLanguage changes and embedding cache', async () => {
    const keyDe = await buildExtractionCacheKey({
      contentHash: 'doc-hash-1',
      extractionConfigHash: 'cfg-1',
      promptHash: 'prompt-v1',
      outputLanguage: 'de',
    });
    const keyEn = await buildExtractionCacheKey({
      contentHash: 'doc-hash-1',
      extractionConfigHash: 'cfg-1',
      promptHash: 'prompt-v1',
      outputLanguage: 'en',
    });
    const keyPromptV2 = await buildExtractionCacheKey({
      contentHash: 'doc-hash-1',
      extractionConfigHash: 'cfg-1',
      promptHash: 'prompt-v2',
      outputLanguage: 'de',
    });

    expect(keyDe).not.toBe(keyEn);
    expect(keyDe).not.toBe(keyPromptV2);

    const record: ExtractionCacheRecord = {
      cacheKey: keyDe,
      documentId: 'doc-1',
      domain: 'biology',
      contentHash: 'doc-hash-1',
      extractionConfigHash: 'cfg-1',
      promptHash: 'prompt-v1',
      outputLanguage: 'de',
      mechanisms: [],
      createdAt: '2026-11-19T10:05:00.000Z',
    };
    await saveExtractionCache(record, testDb);

    expect(await getCachedExtraction(keyDe, testDb)).toEqual(record);
    expect(await getCachedExtraction(keyEn, testDb)).toBeUndefined();
    expect(await getCachedExtraction(keyPromptV2, testDb)).toBeUndefined();

    const latest = await findLatestCacheForContentHash('doc-hash-1', 'biology', testDb);
    expect(latest?.cacheKey).toBe(keyDe);
    expect(await listExtractionCaches('biology', testDb)).toHaveLength(1);

    await deleteExtractionCache(keyDe, testDb);
    expect(await getCachedExtraction(keyDe, testDb)).toBeUndefined();

    await saveEmbeddings(
      [
        {
          itemId: 'mech-1',
          modelId: 'text-embedding-3-small',
          cacheKey: 'emb-1',
          vector: [0.1, 0.2, 0.3],
          createdAt: '2026-11-19T10:10:00.000Z',
        },
        {
          itemId: 'mech-2',
          modelId: 'text-embedding-3-small',
          cacheKey: 'emb-2',
          vector: [0.4, 0.5, 0.6],
          createdAt: '2026-11-19T10:10:00.000Z',
        },
      ],
      testDb,
    );

    const hits = await getEmbeddings(
      ['mech-1', 'mech-missing', 'mech-2'],
      'text-embedding-3-small',
      testDb,
    );
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.itemId)).toEqual(['mech-1', 'mech-2']);
    expect(await getEmbeddings(['mech-1'], 'other-model', testDb)).toHaveLength(0);
  });

  it('persists experiments, updates checkpoints, candidates, reviews, and cascades deletes', async () => {
    const exp1 = makeExperiment('exp-1', '2026-11-19T10:00:00.000Z');
    const exp2 = makeExperiment('exp-2', '2026-11-19T12:00:00.000Z');
    await saveExperiment(exp1, testDb);
    await saveExperiment(exp2, testDb);

    const listed = await listExperiments(testDb);
    expect(listed.map((e) => e.id)).toEqual(['exp-2', 'exp-1']);

    await updateCheckpoint(
      'exp-1',
      {
        currentPhase: 'phase2_extract',
        completedVisionPageKeys: ['doc-1:1'],
        completedChunkKeys: ['chunk-1'],
        completedPairKeys: [],
        completedReviewKeys: [],
      },
      'RUNNING',
      {
        totalInputTokens: 1000,
        totalOutputTokens: 250,
        totalVisionImages: 1,
        totalCostUsd: 0.012,
        entries: [],
      },
      testDb,
    );

    const updatedExp1 = await getExperiment('exp-1', testDb);
    expect(updatedExp1?.status).toBe('RUNNING');
    expect(updatedExp1?.checkpoint.currentPhase).toBe('phase2_extract');
    expect(updatedExp1?.costLedger.totalCostUsd).toBe(0.012);

    const candidate: CrossingCandidate = {
      id: 'cand-1',
      experimentId: 'exp-1',
      mechanismId: 'mech-1',
      problemId: 'prob-1',
      strategyUsed: 'embedding-hybrid',
      similarityScore: 0.82,
      distanceBand: 'balanced',
      bridgeTitle: 'Test Bridge',
      abstractTransferLogic: 'Transfer logic',
      proposedImplementationSketch: 'Sketch',
      keyAssumptions: ['Assumption 1'],
      potentialFailureModes: ['Failure 1'],
      mechanismCitationIds: ['cit-bio-1'],
      problemCitationIds: ['cit-tech-1'],
      createdAt: '2026-11-19T10:30:00.000Z',
    };
    await saveCandidates([candidate], testDb);
    expect(await getCandidatesForExperiment('exp-1', testDb)).toHaveLength(1);

    const review: CriticReview = {
      candidateId: 'cand-1',
      experimentId: 'exp-1',
      criticModelUsed: 'gpt-4o',
      scores: {
        mechanismDepth: 3,
        scalabilityAndConstraints: 2,
        technicalValue: 2,
        novelty: 1,
        evidenceQuality: 'PASS',
      },
      weightedTotalScore: 8,
      status: 'PROMISING',
      criticalCounterarguments: ['Valid concern'],
      openHurdles: ['Scale test'],
      verdictSummary: 'Strong candidate.',
      createdAt: '2026-11-19T10:35:00.000Z',
    };
    await saveReviews([review], testDb);
    expect(await getReviewsForExperiment('exp-1', testDb)).toHaveLength(1);

    await deleteExperimentCascade('exp-1', testDb);
    expect(await getExperiment('exp-1', testDb)).toBeUndefined();
    expect(await getCandidatesForExperiment('exp-1', testDb)).toHaveLength(0);
    expect(await getReviewsForExperiment('exp-1', testDb)).toHaveLength(0);
    expect(await getExperiment('exp-2', testDb)).toBeDefined();
  });

  it('manages typed app settings and prompt profiles', async () => {
    expect(await getSetting('nonexistent', 42, testDb)).toBe(42);
    await setSetting('custom_flag', true, testDb);
    expect(await getSetting('custom_flag', false, testDb)).toBe(true);

    const defaults = await getAppSettings(testDb);
    expect(defaults.transportMode).toBe('direct-byok');
    expect(defaults.defaultOutputLanguage).toBe('de');

    const updated = await saveAppSettings(
      {
        transportMode: 'managed-proxy',
        managedProxyUrl: 'https://proxy.example.com',
        usdToEurRate: 0.95,
        pricingOverrides: {
          'custom-model': { inputPer1MUsd: 1.5, outputPer1MUsd: 4.5 },
        },
      },
      testDb,
    );
    expect(updated.transportMode).toBe('managed-proxy');
    expect(updated.managedProxyUrl).toBe('https://proxy.example.com');
    expect(updated.pricingOverrides['custom-model'].inputPer1MUsd).toBe(1.5);

    const reloaded = await getAppSettings(testDb);
    expect(reloaded.usdToEurRate).toBe(0.95);

    const profile = makePromptProfile('profile-custom');
    await savePromptProfile(profile, testDb);
    expect((await getPromptProfile('profile-custom', testDb))?.name).toBe('Default Profile');
    expect(await listPromptProfiles(testDb)).toHaveLength(1);

    await deletePromptProfile('profile-custom', testDb);
    expect(await listPromptProfiles(testDb)).toHaveLength(0);
  });
});
