import 'fake-indexeddb/auto';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ITransportAdapter,
  NormalizedCompletionRequest,
  NormalizedCompletionResponse,
  NormalizedEmbeddingRequest,
  NormalizedEmbeddingResponse,
} from '@/ai';
import type {
  ExperimentRun,
  ParsedPage,
  RunConfig,
  SourceDocument,
} from '@/core/schemas';
import { estimateExperimentCost } from '@/estimation';
import { chunkDocumentPages } from '@/ingestion';
import { PipelineOrchestrator } from '@/pipeline';
import { createDefaultPromptProfile } from '@/prompts';
import {
  type BioBridgeDB,
  PARSED_PAGE_BATCH_SIZE,
  createBioBridgeDB,
  getCachedExtraction,
  getCandidatesForExperiment,
  getPagesForDocument,
  getReviewsForExperiment,
  saveDocumentWithPages,
  saveExperiment,
} from '@/storage';
import { computeDocExtractionCacheKey } from '@/pipeline/phases/phase2BlindExtract';

const PAGES_PER_BOOK = 320;
const CHAPTER_SIZE = 20;

function buildLargeSyntheticBook(params: {
  documentId: string;
  domain: 'biology' | 'technology';
  fileName: string;
  pageCount?: number;
}): { document: SourceDocument; pages: ParsedPage[] } {
  const pageCount = params.pageCount ?? PAGES_PER_BOOK;
  const pages: ParsedPage[] = [];
  let totalChars = 0;

  for (let p = 1; p <= pageCount; p += 1) {
    const chapterNum = Math.ceil(p / CHAPTER_SIZE);
    const sectionPath = [
      `Chapter ${chapterNum}: ${params.domain === 'biology' ? 'Biological Transport' : 'Distributed Systems'}`,
      `Section ${chapterNum}.${((p - 1) % CHAPTER_SIZE) + 1}`,
    ];

    const keySentence =
      params.domain === 'biology'
        ? `BioPrinciple-${p} demonstrates osmotic valve regulation across xylem membranes with coupling coefficient k_${p}.`
        : `TechBottleneck-${p} exhibits control-plane synchronization latency under bursty micro-batch traffic load_${p}.`;

    const formula =
      params.domain === 'biology'
        ? `$$J_{${p}}(t) = -D_{${p}} \\nabla C(x,t) + \\alpha_{${p}} \\Delta P$$`
        : `$$L_{${p}}(N) = \\tau_0 + \\beta_{${p}} \\log_2(N) + \\frac{\\lambda}{\\mu - \\lambda}$$`;

    const bodyFiller =
      params.domain === 'biology'
        ? `Empirical histological measurements on specimen batch ${p} confirm repeatable hydraulic conductance across vascular bundles without central neural innervation. `
        : `Telemetry benchmarks on cluster partition ${p} indicate bounded local queue stability when peer signaling replaces global state polling. `;

    const rawNormalizedText = [
      `## ${sectionPath[1]}`,
      '',
      keySentence,
      '',
      formula,
      '',
      bodyFiller.repeat(9).trim(),
    ].join('\n');

    totalChars += rawNormalizedText.length;

    pages.push({
      documentId: params.documentId,
      pageNumber: p,
      sectionPath,
      rawNormalizedText,
      blocks: [
        {
          id: `${params.documentId}:b:${p}:1`,
          type: 'heading',
          content: `## ${sectionPath[1]}`,
        },
        {
          id: `${params.documentId}:b:${p}:2`,
          type: 'paragraph',
          content: keySentence,
        },
        {
          id: `${params.documentId}:b:${p}:3`,
          type: 'formula',
          content: formula,
          latex: formula.slice(2, -2),
        },
        {
          id: `${params.documentId}:b:${p}:4`,
          type: 'paragraph',
          content: bodyFiller.repeat(9).trim(),
        },
      ],
    });
  }

  const document: SourceDocument = {
    id: params.documentId,
    domain: params.domain,
    fileName: params.fileName,
    mimeType: 'application/pdf',
    format: 'pdf',
    contentHash: `sha256-synthetic-${params.documentId}-${pageCount}`,
    fileSizeBytes: totalChars,
    pageCount,
    detectedLanguage: 'en',
    stats: {
      totalChars,
      estimatedTokens: Math.ceil(totalChars / 4),
      detectedFigurePages: [12, 45, 110, 240],
      detectedMathAnomalyPages: [25, 180],
    },
    createdAt: new Date().toISOString(),
  };

  return { document, pages };
}

class LargeBookMockTransport implements ITransportAdapter {
  readonly mode = 'direct-byok' as const;
  readonly bioChunkIndexesProcessed: number[] = [];
  readonly techChunkIndexesProcessed: number[] = [];
  readonly schemaCalls: string[] = [];

  private getSchemaName(req: NormalizedCompletionRequest): string {
    if (req.responseFormat?.type === 'json_schema') {
      return req.responseFormat.schemaName;
    }
    return 'unknown';
  }

  async sendEmbedding(
    req: NormalizedEmbeddingRequest,
  ): Promise<NormalizedEmbeddingResponse> {
    return {
      embeddings: req.texts.map((t, i) => [
        ((t.length % 17) + 1) / 20,
        ((i % 13) + 1) / 15,
        0.5,
        0.25,
      ]),
      provider: req.provider,
      modelId: req.modelId,
      usage: {
        inputTokens: req.texts.length * 40,
        outputTokens: 0,
      },
    };
  }

  async sendCompletion(
    req: NormalizedCompletionRequest,
  ): Promise<NormalizedCompletionResponse> {
    const schemaName = this.getSchemaName(req);
    this.schemaCalls.push(schemaName);
    const userMsg = req.messages[req.messages.length - 1]?.content ?? '';

    const wrap = (obj: unknown): NormalizedCompletionResponse => ({
      text: JSON.stringify(obj),
      provider: req.provider,
      modelId: req.modelId,
      usage: {
        inputTokens: Math.max(100, Math.ceil(userMsg.length / 8)),
        outputTokens: 120,
      },
    });

    switch (schemaName) {
      case 'ExtractBioOutput': {
        const chunkMatch = userMsg.match(/Chunk (\d+)\/\d+/);
        if (chunkMatch) {
          this.bioChunkIndexesProcessed.push(Number(chunkMatch[1]) - 1);
        }
        const quoteMatch = userMsg.match(
          /BioPrinciple-(\d+) demonstrates osmotic valve regulation across xylem membranes with coupling coefficient k_\1\./,
        );
        const pageNum = quoteMatch ? Number(quoteMatch[1]) : 1;
        const quoteOriginal = quoteMatch
          ? quoteMatch[0]
          : 'Empirical histological measurements confirm repeatable hydraulic conductance.';

        return wrap({
          mechanisms: [
            {
              title: `Xylem Osmotic Valve Mechanism P${pageNum}`,
              biologicalSystem: 'Vascular plant xylem',
              structure: 'Bordered pit membrane',
              workingPrinciple: `Passive osmotic valve modulation (page ${pageNum})`,
              achievedEffect: 'Cavitation-resistant flow stabilization',
              boundaryConditions: {
                spatialScale: 'um-mm',
                timeScale: 'seconds',
                medium: 'aqueous sap',
                energyForm: 'osmotic pressure',
                operatingConstraints: 'passive membrane threshold',
              },
              functionalAbstract: `Decentralized passive hydraulic flow control (p.${pageNum}).`,
              citations: [
                {
                  pageNumber: pageNum,
                  sectionPath: `Section P${pageNum}`,
                  quoteOriginal,
                },
              ],
            },
          ],
        });
      }

      case 'ExtractTechOutput': {
        const chunkMatch = userMsg.match(/Chunk (\d+)\/\d+/);
        if (chunkMatch) {
          this.techChunkIndexesProcessed.push(Number(chunkMatch[1]) - 1);
        }
        const quoteMatch = userMsg.match(
          /TechBottleneck-(\d+) exhibits control-plane synchronization latency under bursty micro-batch traffic load_\1\./,
        );
        const pageNum = quoteMatch ? Number(quoteMatch[1]) : 1;
        const quoteOriginal = quoteMatch
          ? quoteMatch[0]
          : 'Telemetry benchmarks indicate bounded local queue stability.';

        return wrap({
          problems: [
            {
              title: `Distributed Queue Synchronization Bottleneck P${pageNum}`,
              technicalDomain: 'Distributed Compute Clusters',
              problemStatement: 'Global polling causes control-plane saturation',
              coreBottleneck: 'Centralized state synchronization lag',
              targetMetrics: 'p99 < 10ms',
              currentApproachesAndLimits: 'Centralized lock-step barriers',
              boundaryConditions: {
                spatialScale: 'cluster nodes',
                timeScale: 'milliseconds',
                medium: 'packet network',
                energyForm: 'electrical',
                operatingConstraints: 'bounded bandwidth',
              },
              functionalNeedAbstract: `Local flow stability under bursty arrivals (p.${pageNum}).`,
              citations: [
                {
                  pageNumber: pageNum,
                  sectionPath: `Section P${pageNum}`,
                  quoteOriginal,
                },
              ],
            },
          ],
        });
      }

      case 'ConsolidateMechanismsOutput': {
        const parsed = JSON.parse(userMsg) as {
          items: Array<Record<string, unknown> & { id: string }>;
        };
        const chunkSize = Math.max(2, Math.ceil(parsed.items.length / 4));
        const consolidatedItems = [];
        for (let i = 0; i < parsed.items.length; i += chunkSize) {
          const slice = parsed.items.slice(i, i + chunkSize);
          consolidatedItems.push({
            mergedFromIds: slice.map((item) => item.id),
            canonicalItem: {
              ...slice[0],
              title: `Consolidated Biology Group ${consolidatedItems.length + 1}`,
            },
          });
        }
        return wrap({ consolidatedItems });
      }

      case 'ConsolidateProblemsOutput': {
        const parsed = JSON.parse(userMsg) as {
          items: Array<Record<string, unknown> & { id: string }>;
        };
        const chunkSize = Math.max(2, Math.ceil(parsed.items.length / 4));
        const consolidatedItems = [];
        for (let i = 0; i < parsed.items.length; i += chunkSize) {
          const slice = parsed.items.slice(i, i + chunkSize);
          consolidatedItems.push({
            mergedFromIds: slice.map((item) => item.id),
            canonicalItem: {
              ...slice[0],
              title: `Consolidated Tech Group ${consolidatedItems.length + 1}`,
            },
          });
        }
        return wrap({ consolidatedItems });
      }

      case 'DomainClustersOutput': {
        const parsed = JSON.parse(userMsg) as {
          domain: string;
          items: Array<{ id: string }>;
        };
        return wrap({
          clusters: [
            {
              id: `${parsed.domain}-c1`,
              label: `${parsed.domain} Main Cluster`,
              description: 'Primary functional cluster',
              memberIds: parsed.items.map((i) => i.id),
            },
          ],
        });
      }

      case 'CrossingCandidatesOutput': {
        const parsed = JSON.parse(userMsg) as {
          pairs: Array<{
            mechanism: {
              mechanismId: string;
              title: string;
              citations: Array<{ citationId: string }>;
            };
            problem: {
              problemId: string;
              title: string;
              citations: Array<{ citationId: string }>;
            };
          }>;
        };
        return wrap({
          candidates: parsed.pairs.map((pair) => ({
            mechanismId: pair.mechanism.mechanismId,
            problemId: pair.problem.problemId,
            bridgeTitle: `${pair.mechanism.title} -> ${pair.problem.title}`,
            abstractTransferLogic: 'Passive local flux threshold regulates burst admission.',
            proposedImplementationSketch: 'Local backpressure valve per compute node.',
            keyAssumptions: ['Local queue depth correlates with downstream pressure'],
            potentialFailureModes: ['Over-damping under sustained overload'],
            mechanismCitationIds: pair.mechanism.citations.map((c) => c.citationId),
            problemCitationIds: pair.problem.citations.map((c) => c.citationId),
          })),
        });
      }

      case 'CriticReviewOutput': {
        return wrap({
          scores: {
            mechanismDepth: 3,
            scalabilityAndConstraints: 2,
            technicalValue: 2,
            novelty: 1,
            evidenceQuality: 'PASS',
          },
          status: 'PROMISING',
          criticalCounterarguments: [
            'Fluid viscosity dynamics do not map 1:1 to discrete packet scheduling without hysteresis.',
          ],
          openHurdles: ['Tune threshold hysteresis for heterogeneous worker latencies'],
          verdictSummary: 'Grounded large-book cross-domain transfer candidate.',
        });
      }

      default:
        throw new Error(`Unexpected schemaName in LargeBookMockTransport: ${schemaName}`);
    }
  }
}

function makeLargeDocConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    outputLanguage: 'en',
    crossingStrategy: 'embedding-hybrid',
    creativityDistance: 0.5,
    distanceBand: 'balanced',
    maxCandidates: 4,
    includeDiagrams: false,
    pdfMathVisionMode: 'off',
    modelAssignments: {
      extraction: { provider: 'gemini', modelId: 'gemini-2.5-flash', temperature: 0.1 },
      vision: { provider: 'gemini', modelId: 'gemini-2.5-flash', temperature: 0.1 },
      embedding: { provider: 'openai', modelId: 'text-embedding-3-small' },
      crossing: { provider: 'gemini', modelId: 'gemini-2.5-pro', temperature: 0.4 },
      critic: { provider: 'anthropic', modelId: 'claude-3-7-sonnet-latest', temperature: 0.1 },
    },
    weights: {
      mechanismDepth: 1,
      scalabilityAndConstraints: 1,
      technicalValue: 1,
      novelty: 1,
    },
    promptProfileSnapshot: createDefaultPromptProfile(),
    ...overrides,
  };
}

describe('Large-Document Performance, Memory & Checkpoint Stress Tests (>= 320 pages/domain)', () => {
  let db: BioBridgeDB;
  let dbCounter = 0;

  beforeEach(() => {
    dbCounter += 1;
    db = createBioBridgeDB(`biobridge_perf_${Date.now()}_${dbCounter}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('1. stores and retrieves 640 pages (320 bio + 320 tech) via 75-page IndexedDB batches quickly', async () => {
    expect(PARSED_PAGE_BATCH_SIZE).toBe(75);
    const bioBook = buildLargeSyntheticBook({
      documentId: 'perf-bio-320',
      domain: 'biology',
      fileName: 'bio_textbook_320p.pdf',
    });
    const techBook = buildLargeSyntheticBook({
      documentId: 'perf-tech-320',
      domain: 'technology',
      fileName: 'tech_textbook_320p.pdf',
    });

    const saveStart = performance.now();
    await saveDocumentWithPages(bioBook.document, bioBook.pages, db);
    await saveDocumentWithPages(techBook.document, techBook.pages, db);
    const saveElapsedMs = performance.now() - saveStart;

    const readStart = performance.now();
    const loadedBioPages = await getPagesForDocument(bioBook.document.id, db);
    const loadedTechPages = await getPagesForDocument(techBook.document.id, db);
    const readElapsedMs = performance.now() - readStart;

    expect(loadedBioPages).toHaveLength(PAGES_PER_BOOK);
    expect(loadedTechPages).toHaveLength(PAGES_PER_BOOK);
    expect(loadedBioPages[0].pageNumber).toBe(1);
    expect(loadedBioPages[PAGES_PER_BOOK - 1].pageNumber).toBe(PAGES_PER_BOOK);
    expect(loadedTechPages[0].pageNumber).toBe(1);
    expect(loadedTechPages[PAGES_PER_BOOK - 1].pageNumber).toBe(PAGES_PER_BOOK);

    expect(saveElapsedMs).toBeLessThan(10_000);
    expect(readElapsedMs).toBeLessThan(5_000);
  });

  it('2. chunks both 320-page books (< 2s) with full [[PAGE:N]] marker coverage and bounded chunk sizes', () => {
    const bioBook = buildLargeSyntheticBook({
      documentId: 'chunk-bio-320',
      domain: 'biology',
      fileName: 'bio_chunk_320p.pdf',
    });
    const techBook = buildLargeSyntheticBook({
      documentId: 'chunk-tech-320',
      domain: 'technology',
      fileName: 'tech_chunk_320p.pdf',
    });

    const start = performance.now();
    const bioChunks = chunkDocumentPages(bioBook.document, bioBook.pages);
    const techChunks = chunkDocumentPages(techBook.document, techBook.pages);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(2000);
    expect(bioChunks.length).toBeGreaterThan(20);
    expect(techChunks.length).toBeGreaterThan(20);

    for (const [label, chunks] of [
      ['bio', bioChunks],
      ['tech', techChunks],
    ] as const) {
      const coveredPages = new Set<number>();
      for (const chunk of chunks) {
        // Every chunk stays within default maxTokens + small overlap/marker headroom
        expect(chunk.estimatedTokens).toBeLessThanOrEqual(4800);
        expect(chunk.estimatedTokens).toBeGreaterThan(0);

        const matches = Array.from(chunk.text.matchAll(/\[\[PAGE:(\d+)\]\]/g));
        expect(matches.length, `${label} chunk ${chunk.chunkIndex} missing page marker`).toBeGreaterThan(0);
        for (const m of matches) {
          coveredPages.add(Number(m[1]));
        }
      }

      for (let p = 1; p <= PAGES_PER_BOOK; p += 1) {
        expect(coveredPages.has(p), `${label} missing [[PAGE:${p}]] marker`).toBe(true);
      }
    }
  });

  it('3. computes pre-flight cost estimate for 640 pages and shows drastic savings when 1 book is cached', () => {
    const bioBook = buildLargeSyntheticBook({
      documentId: 'cost-bio-320',
      domain: 'biology',
      fileName: 'bio_cost_320p.pdf',
    });
    const techBook = buildLargeSyntheticBook({
      documentId: 'cost-tech-320',
      domain: 'technology',
      fileName: 'tech_cost_320p.pdf',
    });

    const config = makeLargeDocConfig({ includeDiagrams: true, pdfMathVisionMode: 'auto' });

    const uncachedEstimate = estimateExperimentCost({
      biologyDocs: [bioBook.document],
      technologyDocs: [techBook.document],
      cachedDocumentIds: [],
      config,
    });

    const halfCachedEstimate = estimateExperimentCost({
      biologyDocs: [bioBook.document],
      technologyDocs: [techBook.document],
      cachedDocumentIds: [bioBook.document.id],
      config,
    });

    expect(uncachedEstimate.phase2Extract.expectedUsd).toBeGreaterThan(0);
    expect(halfCachedEstimate.cachedDocumentIds).toEqual([bioBook.document.id]);

    // Phase 2 extraction cost must drop by ~50% when 1 of 2 identical-size 320-page books is cached
    expect(halfCachedEstimate.phase2Extract.expectedUsd).toBeLessThan(
      uncachedEstimate.phase2Extract.expectedUsd * 0.6,
    );
    expect(halfCachedEstimate.total.expectedUsd).toBeLessThan(
      uncachedEstimate.total.expectedUsd * 0.75,
    );
  });

  it('4. completes multi-chunk 320-page book pipeline with simulated 30% abort & checkpoint resume without duplicate chunks or memory spikes', async () => {
    const bioBook = buildLargeSyntheticBook({
      documentId: 'resume-bio-320',
      domain: 'biology',
      fileName: 'bio_resume_320p.pdf',
    });
    const techMini = buildLargeSyntheticBook({
      documentId: 'resume-tech-mini',
      domain: 'technology',
      fileName: 'tech_resume_mini.pdf',
      pageCount: 6,
    });

    await saveDocumentWithPages(bioBook.document, bioBook.pages, db);
    await saveDocumentWithPages(techMini.document, techMini.pages, db);

    const expectedBioChunks = chunkDocumentPages(bioBook.document, bioBook.pages);
    const expectedTechChunks = chunkDocumentPages(techMini.document, techMini.pages);
    const pauseAfterBioChunks = Math.max(2, Math.floor(expectedBioChunks.length * 0.3));

    const config = makeLargeDocConfig({
      crossingStrategy: 'embedding-hybrid',
      maxCandidates: 4,
    });

    const now = new Date().toISOString();
    const exp: ExperimentRun = {
      id: 'exp-large-resume-320',
      name: 'Large Book 320p Checkpoint Resume Test',
      createdAt: now,
      updatedAt: now,
      status: 'DRAFT',
      biologyDocIds: [bioBook.document.id],
      technologyDocIds: [techMini.document.id],
      config,
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
    await saveExperiment(exp, db);

    const heapBefore = process.memoryUsage().heapUsed;

    // Run 1: abort cleanly as PAUSED after 30% of biology chunks
    const transport1 = new LargeBookMockTransport();
    const orchestrator1 = new PipelineOrchestrator({
      db,
      transport: transport1,
      sleep: async () => {},
      onEvent: (event) => {
        if (
          event.type === 'progress' &&
          event.phase === 'phase2_extract' &&
          event.completed >= pauseAfterBioChunks
        ) {
          orchestrator1.requestStopAsPaused();
        }
      },
    });

    const pausedRun = await orchestrator1.run(exp.id);
    expect(pausedRun.status).toBe('PAUSED');
    expect(pausedRun.checkpoint.currentPhase).toBe('phase2_extract');
    expect(pausedRun.checkpoint.completedChunkKeys).toHaveLength(pauseAfterBioChunks);
    expect(transport1.bioChunkIndexesProcessed).toHaveLength(pauseAfterBioChunks);

    // Run 2: fresh orchestrator instance resumes from checkpoint
    const transport2 = new LargeBookMockTransport();
    const orchestrator2 = new PipelineOrchestrator({
      db,
      transport: transport2,
      sleep: async () => {},
    });

    const completedRun = await orchestrator2.run(exp.id);
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMb = (heapAfter - heapBefore) / (1024 * 1024);

    expect(completedRun.status).toBe('COMPLETED');
    expect(completedRun.checkpoint.currentPhase).toBe('completed');

    // Verify exact chunk coverage with zero duplicates across Run 1 and Run 2
    const allProcessedBioChunks = [
      ...transport1.bioChunkIndexesProcessed,
      ...transport2.bioChunkIndexesProcessed,
    ];
    expect(allProcessedBioChunks).toHaveLength(expectedBioChunks.length);
    expect(new Set(allProcessedBioChunks).size).toBe(expectedBioChunks.length);
    expect(transport2.bioChunkIndexesProcessed).toHaveLength(
      expectedBioChunks.length - pauseAfterBioChunks,
    );

    // Technology chunks processed exactly once in Run 2
    expect(transport2.techChunkIndexesProcessed).toHaveLength(expectedTechChunks.length);

    // Verify 0 data loss in final cached biology extraction (citations span pre-pause and post-resume pages)
    const { cacheKey } = await computeDocExtractionCacheKey(bioBook.document, config);
    const finalBioCache = await getCachedExtraction(cacheKey, db);
    expect(finalBioCache).toBeDefined();
    const allCitedPages = (finalBioCache!.mechanisms ?? []).flatMap((m) =>
      m.citations.map((c) => c.pageNumber),
    );
    expect(allCitedPages.some((p) => p <= 90)).toBe(true);
    expect(allCitedPages.some((p) => p >= 250)).toBe(true);

    // Candidates and reviews completed
    const candidates = await getCandidatesForExperiment(exp.id, db);
    const reviews = await getReviewsForExperiment(exp.id, db);
    expect(candidates).toHaveLength(4);
    expect(reviews).toHaveLength(4);

    // Moderate heap growth (< 250 MB)
    expect(heapDeltaMb).toBeLessThan(250);
  }, 20_000);
});
