import { z } from 'zod';
import { requestStructuredOutput, type UsageReceipt } from '@/ai';
import type {
  Citation,
  Domain,
  ExtractedMechanism,
  ExtractedProblem,
  ExtractionCacheRecord,
  ParsedPage,
  RunConfig,
  SourceDocument,
} from '@/core/schemas';
import { hashJsonStable } from '@/core/utils/hash';
import { chunkDocumentPages } from '@/ingestion/chunker';
import {
  CITATION_REPAIR_PROMPT,
  CONSOLIDATE_PROMPT,
  EXTRACT_BIO_PROMPT,
  EXTRACT_TECH_PROMPT,
  compilePrompt,
  computePromptProfileHash,
} from '@/prompts';
import {
  buildExtractionCacheKey,
  deleteExtractionCache,
  getCachedExtraction,
  getPagesForDocument,
  saveExtractionCache,
} from '@/storage';
import { verifyCitationWithSelfCorrection } from '@/verification';
import type { PipelineRuntimeContext } from '../orchestrator';
import {
  BudgetLimitExceededError,
  createQueuedTransport,
} from '../strategies/crossingStrategy.interface';

const RawCitationSchema = z.object({
  pageNumber: z.number().int().min(1),
  sectionPath: z.string(),
  quoteOriginal: z.string().min(1),
  quoteTranslation: z.string().optional(),
});

const RawBoundaryConditionsSchema = z.object({
  spatialScale: z.string(),
  timeScale: z.string(),
  medium: z.string(),
  energyForm: z.string(),
  operatingConstraints: z.string(),
  faultTolerance: z.string().optional(),
  reliabilityRequirements: z.string().optional(),
});

const RawMechanismSchema = z.object({
  title: z.string().min(1),
  biologicalSystem: z.string().min(1),
  structure: z.string().min(1),
  workingPrinciple: z.string().min(1),
  achievedEffect: z.string().min(1),
  boundaryConditions: RawBoundaryConditionsSchema,
  functionalAbstract: z.string().min(1),
  citations: z.array(RawCitationSchema).min(1),
});

const RawExtractBioOutputSchema = z.object({
  mechanisms: z.array(RawMechanismSchema),
});

const RawProblemSchema = z.object({
  title: z.string().min(1),
  technicalDomain: z.string().min(1),
  problemStatement: z.string().min(1),
  coreBottleneck: z.string().min(1),
  targetMetrics: z.string(),
  currentApproachesAndLimits: z.string(),
  boundaryConditions: RawBoundaryConditionsSchema,
  functionalNeedAbstract: z.string().min(1),
  citations: z.array(RawCitationSchema).min(1),
});

const RawExtractTechOutputSchema = z.object({
  problems: z.array(RawProblemSchema),
});

const ConsolidateBioOutputSchema = z.object({
  consolidatedItems: z.array(
    z.object({
      mergedFromIds: z.array(z.string().min(1)).min(1),
      canonicalItem: RawMechanismSchema.extend({
        id: z.string().optional(),
        sourceDocumentIds: z.array(z.string()).optional(),
        citations: z.array(z.unknown()).optional(),
      }),
    }),
  ),
});

const ConsolidateTechOutputSchema = z.object({
  consolidatedItems: z.array(
    z.object({
      mergedFromIds: z.array(z.string().min(1)).min(1),
      canonicalItem: RawProblemSchema.extend({
        id: z.string().optional(),
        sourceDocumentIds: z.array(z.string()).optional(),
        citations: z.array(z.unknown()).optional(),
      }),
    }),
  ),
});

export interface Phase2ExtractResult {
  mechanisms: ExtractedMechanism[];
  problems: ExtractedProblem[];
  cacheHits: string[];
}

export async function computeExtractionConfigHash(
  config: RunConfig,
): Promise<string> {
  return hashJsonStable({
    extraction: config.modelAssignments.extraction,
    vision: config.modelAssignments.vision,
    includeDiagrams: config.includeDiagrams,
    pdfMathVisionMode: config.pdfMathVisionMode,
  });
}

export async function computeDocExtractionCacheKey(
  doc: SourceDocument,
  config: RunConfig,
  precomputed?: { extractionConfigHash: string; promptHash: string },
): Promise<{
  cacheKey: string;
  extractionConfigHash: string;
  promptHash: string;
}> {
  const extractionConfigHash =
    precomputed?.extractionConfigHash ?? (await computeExtractionConfigHash(config));
  const promptHash =
    precomputed?.promptHash ??
    (await computePromptProfileHash(config.promptProfileSnapshot));

  const cacheKey = await buildExtractionCacheKey({
    contentHash: doc.contentHash,
    extractionConfigHash,
    promptHash,
    outputLanguage: config.outputLanguage,
  });

  return { cacheKey, extractionConfigHash, promptHash };
}

function buildInterimCacheKey(experimentId: string, docId: string): string {
  return `interim:${experimentId}:${docId}`;
}

function collectMergedMetadata<T extends ExtractedMechanism | ExtractedProblem>(
  mergedIds: string[],
  byId: Map<string, T>,
  fallbackDocId: string,
): {
  sourceDocumentIds: string[];
  citations: Citation[];
} {
  const docIds = new Set<string>();
  const citations = new Map<string, Citation>();

  for (const id of mergedIds) {
    const item = byId.get(id);
    if (!item) continue;
    for (const d of item.sourceDocumentIds) {
      docIds.add(d);
    }
    for (const cit of item.citations) {
      citations.set(cit.id, cit);
    }
  }

  if (docIds.size === 0) {
    docIds.add(fallbackDocId);
  }

  return {
    sourceDocumentIds: Array.from(docIds),
    citations: Array.from(citations.values()),
  };
}

async function consolidateMechanisms(params: {
  ctx: PipelineRuntimeContext;
  doc: SourceDocument;
  items: ExtractedMechanism[];
}): Promise<ExtractedMechanism[]> {
  const { ctx, doc, items } = params;
  const { config } = ctx.experiment;
  const extractionModel = config.modelAssignments.extraction;
  const consolidatePrompt = compilePrompt(
    config.promptProfileSnapshot.slots.consolidate ?? CONSOLIDATE_PROMPT,
    {
      OUTPUT_LANGUAGE: config.outputLanguage,
      DOMAIN: 'biology',
    },
  );

  const usageTasks: Promise<void>[] = [];
  let deferredBudgetError: BudgetLimitExceededError | null = null;
  const onUsage = (usage: UsageReceipt): void => {
    const task = ctx
      .recordUsage(
        'phase2_extract',
        'extraction',
        extractionModel.provider,
        extractionModel.modelId,
        usage,
      )
      .catch((err: unknown) => {
        if (err instanceof BudgetLimitExceededError) {
          deferredBudgetError ??= err;
          return;
        }
        throw err;
      });
    usageTasks.push(task);
  };

  const structured = await ctx.queue.enqueue(
    (qSignal) =>
      requestStructuredOutput({
        transport: ctx.transport,
        request: {
          provider: extractionModel.provider,
          modelId: extractionModel.modelId,
          role: 'extraction',
          temperature: extractionModel.temperature ?? 0.1,
          reasoningEffort: extractionModel.reasoningEffort,
          messages: [
            { role: 'system', content: consolidatePrompt },
            {
              role: 'user',
              content: JSON.stringify(
                {
                  documentTitle: doc.fileName,
                  domain: 'biology',
                  items,
                },
                null,
                2,
              ),
            },
          ],
          metadata: {
            experimentId: ctx.experiment.id,
            phase: 'phase2_extract',
          },
        },
        schema: ConsolidateBioOutputSchema,
        schemaName: 'ConsolidateMechanismsOutput',
        signal: qSignal,
        onUsage,
      }),
    ctx.signal,
  );

  await Promise.all(usageTasks);

  const byId = new Map(items.map((item) => [item.id, item]));
  const claimedIds = new Set<string>();
  const consolidated: ExtractedMechanism[] = [];

  for (const group of structured.data.consolidatedItems) {
    const validIds = group.mergedFromIds.filter(
      (id) => byId.has(id) && !claimedIds.has(id),
    );
    if (validIds.length === 0) {
      continue;
    }
    for (const id of validIds) {
      claimedIds.add(id);
    }
    const { sourceDocumentIds, citations } = collectMergedMetadata(
      validIds,
      byId,
      doc.id,
    );
    const canonical = group.canonicalItem;
    consolidated.push({
      id: validIds[0],
      sourceDocumentIds,
      title: canonical.title,
      biologicalSystem: canonical.biologicalSystem,
      structure: canonical.structure,
      workingPrinciple: canonical.workingPrinciple,
      achievedEffect: canonical.achievedEffect,
      boundaryConditions: canonical.boundaryConditions,
      functionalAbstract: canonical.functionalAbstract,
      citations,
    });
  }

  // Deterministic fallback for any input item omitted by LLM
  for (const item of items) {
    if (!claimedIds.has(item.id)) {
      consolidated.push(item);
    }
  }

  if (deferredBudgetError) {
    throw deferredBudgetError;
  }

  return consolidated;
}

async function consolidateProblems(params: {
  ctx: PipelineRuntimeContext;
  doc: SourceDocument;
  items: ExtractedProblem[];
}): Promise<ExtractedProblem[]> {
  const { ctx, doc, items } = params;
  const { config } = ctx.experiment;
  const extractionModel = config.modelAssignments.extraction;
  const consolidatePrompt = compilePrompt(
    config.promptProfileSnapshot.slots.consolidate ?? CONSOLIDATE_PROMPT,
    {
      OUTPUT_LANGUAGE: config.outputLanguage,
      DOMAIN: 'technology',
    },
  );

  const usageTasks: Promise<void>[] = [];
  let deferredBudgetError: BudgetLimitExceededError | null = null;
  const onUsage = (usage: UsageReceipt): void => {
    const task = ctx
      .recordUsage(
        'phase2_extract',
        'extraction',
        extractionModel.provider,
        extractionModel.modelId,
        usage,
      )
      .catch((err: unknown) => {
        if (err instanceof BudgetLimitExceededError) {
          deferredBudgetError ??= err;
          return;
        }
        throw err;
      });
    usageTasks.push(task);
  };

  const structured = await ctx.queue.enqueue(
    (qSignal) =>
      requestStructuredOutput({
        transport: ctx.transport,
        request: {
          provider: extractionModel.provider,
          modelId: extractionModel.modelId,
          role: 'extraction',
          temperature: extractionModel.temperature ?? 0.1,
          reasoningEffort: extractionModel.reasoningEffort,
          messages: [
            { role: 'system', content: consolidatePrompt },
            {
              role: 'user',
              content: JSON.stringify(
                {
                  documentTitle: doc.fileName,
                  domain: 'technology',
                  items,
                },
                null,
                2,
              ),
            },
          ],
          metadata: {
            experimentId: ctx.experiment.id,
            phase: 'phase2_extract',
          },
        },
        schema: ConsolidateTechOutputSchema,
        schemaName: 'ConsolidateProblemsOutput',
        signal: qSignal,
        onUsage,
      }),
    ctx.signal,
  );

  await Promise.all(usageTasks);

  const byId = new Map(items.map((item) => [item.id, item]));
  const claimedIds = new Set<string>();
  const consolidated: ExtractedProblem[] = [];

  for (const group of structured.data.consolidatedItems) {
    const validIds = group.mergedFromIds.filter(
      (id) => byId.has(id) && !claimedIds.has(id),
    );
    if (validIds.length === 0) {
      continue;
    }
    for (const id of validIds) {
      claimedIds.add(id);
    }
    const { sourceDocumentIds, citations } = collectMergedMetadata(
      validIds,
      byId,
      doc.id,
    );
    const canonical = group.canonicalItem;
    consolidated.push({
      id: validIds[0],
      sourceDocumentIds,
      title: canonical.title,
      technicalDomain: canonical.technicalDomain,
      problemStatement: canonical.problemStatement,
      coreBottleneck: canonical.coreBottleneck,
      targetMetrics: canonical.targetMetrics,
      currentApproachesAndLimits: canonical.currentApproachesAndLimits,
      boundaryConditions: canonical.boundaryConditions,
      functionalNeedAbstract: canonical.functionalNeedAbstract,
      citations,
    });
  }

  for (const item of items) {
    if (!claimedIds.has(item.id)) {
      consolidated.push(item);
    }
  }

  if (deferredBudgetError) {
    throw deferredBudgetError;
  }

  return consolidated;
}

async function verifyItemCitations(params: {
  ctx: PipelineRuntimeContext;
  doc: SourceDocument;
  pages: ParsedPage[];
  chunkText: string;
  itemId: string;
  rawCitations: Array<z.infer<typeof RawCitationSchema>>;
  onDeferredBudgetError: (err: BudgetLimitExceededError) => void;
}): Promise<Citation[]> {
  const { ctx, doc, pages, chunkText, itemId, rawCitations, onDeferredBudgetError } =
    params;
  const { config } = ctx.experiment;
  const queuedTransport = createQueuedTransport(ctx);
  const verifiedCitations: Citation[] = [];

  for (let citIdx = 0; citIdx < rawCitations.length; citIdx += 1) {
    const rawCit = rawCitations[citIdx];
    const usageTasks: Promise<void>[] = [];

    const onUsage = (usage: UsageReceipt): void => {
      const task = ctx
        .recordUsage(
          'phase2_extract',
          'extraction',
          config.modelAssignments.extraction.provider,
          config.modelAssignments.extraction.modelId,
          usage,
        )
        .catch((err: unknown) => {
          if (err instanceof BudgetLimitExceededError) {
            onDeferredBudgetError(err);
            return;
          }
          throw err;
        });
      usageTasks.push(task);
    };

    const result = await verifyCitationWithSelfCorrection({
      citation: {
        id: `${itemId}:cit:${citIdx}`,
        documentId: doc.id,
        documentTitle: doc.fileName,
        pageNumber: rawCit.pageNumber,
        sectionPath: rawCit.sectionPath,
        quoteOriginal: rawCit.quoteOriginal,
        quoteTranslation: rawCit.quoteTranslation,
      },
      pages,
      sourceChunkText: chunkText,
      transport: queuedTransport,
      modelAssignment: config.modelAssignments.extraction,
      repairPromptSlot:
        config.promptProfileSnapshot.slots.citationRepair ?? CITATION_REPAIR_PROMPT,
      signal: ctx.signal,
      onUsage,
    });

    await Promise.all(usageTasks);

    ctx.emit({
      type: 'citation_verified',
      experimentId: ctx.experiment.id,
      documentTitle: doc.fileName,
      pageNumber: result.citation.verification.matchedPageNumber,
      status: result.citation.verification.status,
      attempts: result.attempts,
      timestamp: new Date().toISOString(),
    });

    verifiedCitations.push(result.citation);
  }

  return verifiedCitations;
}

async function extractDocumentForDomain(params: {
  ctx: PipelineRuntimeContext;
  doc: SourceDocument;
  domain: Domain;
  extractionConfigHash: string;
  promptHash: string;
  completedChunkCountRef: { value: number };
  totalChunkEstimate: number;
}): Promise<{
  mechanisms: ExtractedMechanism[];
  problems: ExtractedProblem[];
  cacheHit: boolean;
}> {
  const {
    ctx,
    doc,
    domain,
    extractionConfigHash,
    promptHash,
    completedChunkCountRef,
    totalChunkEstimate,
  } = params;
  const { config } = ctx.experiment;

  const { cacheKey } = await computeDocExtractionCacheKey(doc, config, {
    extractionConfigHash,
    promptHash,
  });

  const cached = await getCachedExtraction(cacheKey, ctx.db);
  if (cached) {
    ctx.emit({
      type: 'log',
      experimentId: ctx.experiment.id,
      level: 'info',
      phase: 'phase2_extract',
      message: `Cache-Hit für "${doc.fileName}" (${domain}) — 0 LLM-Calls.`,
      timestamp: new Date().toISOString(),
    });
    return {
      mechanisms: cached.mechanisms ?? [],
      problems: cached.problems ?? [],
      cacheHit: true,
    };
  }

  const pages = await getPagesForDocument(doc.id, ctx.db);
  const chunks = chunkDocumentPages(doc, pages);

  const interimKey = buildInterimCacheKey(ctx.experiment.id, doc.id);
  const interimRecord = await getCachedExtraction(interimKey, ctx.db);

  let mechanisms: ExtractedMechanism[] = interimRecord?.mechanisms
    ? [...interimRecord.mechanisms]
    : [];
  let problems: ExtractedProblem[] = interimRecord?.problems
    ? [...interimRecord.problems]
    : [];

  const completedChunkSet = new Set(ctx.experiment.checkpoint.completedChunkKeys);
  const extractionModel = config.modelAssignments.extraction;
  const slot =
    domain === 'biology'
      ? (config.promptProfileSnapshot.slots.extractBio ?? EXTRACT_BIO_PROMPT)
      : (config.promptProfileSnapshot.slots.extractTech ?? EXTRACT_TECH_PROMPT);
  const systemPrompt = compilePrompt(slot, {
    OUTPUT_LANGUAGE: config.outputLanguage,
    DOCUMENT_TITLE: doc.fileName,
  });

  for (const chunk of chunks) {
    if (completedChunkSet.has(chunk.chunkKey)) {
      completedChunkCountRef.value += 1;
      continue;
    }

    await ctx.checkBudgetAndPause();

    const usageTasks: Promise<void>[] = [];
    let deferredBudgetError: BudgetLimitExceededError | null = null;
    const captureBudgetError = (err: BudgetLimitExceededError) => {
      deferredBudgetError ??= err;
    };

    const onUsage = (usage: UsageReceipt): void => {
      const task = ctx
        .recordUsage(
          'phase2_extract',
          'extraction',
          extractionModel.provider,
          extractionModel.modelId,
          usage,
        )
        .catch((err: unknown) => {
          if (err instanceof BudgetLimitExceededError) {
            captureBudgetError(err);
            return;
          }
          throw err;
        });
      usageTasks.push(task);
    };

    const userContent = [
      `Dokument: ${doc.fileName}`,
      `Chunk ${chunk.chunkIndex + 1}/${chunks.length} (Seiten ${chunk.startPage}-${chunk.endPage})`,
      chunk.sectionPath.length > 0
        ? `Abschnitt: ${chunk.sectionPath.join(' > ')}`
        : '',
      '',
      chunk.text,
    ]
      .filter((line) => line !== undefined)
      .join('\n');

    if (domain === 'biology') {
      const structured = await ctx.queue.enqueue(
        (qSignal) =>
          requestStructuredOutput({
            transport: ctx.transport,
            request: {
              provider: extractionModel.provider,
              modelId: extractionModel.modelId,
              role: 'extraction',
              temperature: extractionModel.temperature ?? 0.1,
              reasoningEffort: extractionModel.reasoningEffort,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent },
              ],
              metadata: {
                experimentId: ctx.experiment.id,
                phase: 'phase2_extract',
              },
            },
            schema: RawExtractBioOutputSchema,
            schemaName: 'ExtractBioOutput',
            signal: qSignal,
            onUsage,
          }),
        ctx.signal,
      );

      await Promise.all(usageTasks);

      for (let idx = 0; idx < structured.data.mechanisms.length; idx += 1) {
        const rawMech = structured.data.mechanisms[idx];
        const itemId = `mech:${doc.id}:c${chunk.chunkIndex}:${idx}`;
        const citations = await verifyItemCitations({
          ctx,
          doc,
          pages,
          chunkText: chunk.text,
          itemId,
          rawCitations: rawMech.citations,
          onDeferredBudgetError: captureBudgetError,
        });

        mechanisms.push({
          id: itemId,
          sourceDocumentIds: [doc.id],
          title: rawMech.title,
          biologicalSystem: rawMech.biologicalSystem,
          structure: rawMech.structure,
          workingPrinciple: rawMech.workingPrinciple,
          achievedEffect: rawMech.achievedEffect,
          boundaryConditions: rawMech.boundaryConditions,
          functionalAbstract: rawMech.functionalAbstract,
          citations,
        });
      }
    } else {
      const structured = await ctx.queue.enqueue(
        (qSignal) =>
          requestStructuredOutput({
            transport: ctx.transport,
            request: {
              provider: extractionModel.provider,
              modelId: extractionModel.modelId,
              role: 'extraction',
              temperature: extractionModel.temperature ?? 0.1,
              reasoningEffort: extractionModel.reasoningEffort,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent },
              ],
              metadata: {
                experimentId: ctx.experiment.id,
                phase: 'phase2_extract',
              },
            },
            schema: RawExtractTechOutputSchema,
            schemaName: 'ExtractTechOutput',
            signal: qSignal,
            onUsage,
          }),
        ctx.signal,
      );

      await Promise.all(usageTasks);

      for (let idx = 0; idx < structured.data.problems.length; idx += 1) {
        const rawProb = structured.data.problems[idx];
        const itemId = `prob:${doc.id}:c${chunk.chunkIndex}:${idx}`;
        const citations = await verifyItemCitations({
          ctx,
          doc,
          pages,
          chunkText: chunk.text,
          itemId,
          rawCitations: rawProb.citations,
          onDeferredBudgetError: captureBudgetError,
        });

        problems.push({
          id: itemId,
          sourceDocumentIds: [doc.id],
          title: rawProb.title,
          technicalDomain: rawProb.technicalDomain,
          problemStatement: rawProb.problemStatement,
          coreBottleneck: rawProb.coreBottleneck,
          targetMetrics: rawProb.targetMetrics,
          currentApproachesAndLimits: rawProb.currentApproachesAndLimits,
          boundaryConditions: rawProb.boundaryConditions,
          functionalNeedAbstract: rawProb.functionalNeedAbstract,
          citations,
        });
      }
    }

    // Persist interim items before saving checkpoint so resume never loses completed chunks
    await saveExtractionCache(
      {
        cacheKey: interimKey,
        documentId: doc.id,
        domain,
        contentHash: `interim:${ctx.experiment.id}:${doc.contentHash}`,
        extractionConfigHash,
        promptHash,
        outputLanguage: config.outputLanguage,
        ...(domain === 'biology' ? { mechanisms } : { problems }),
        createdAt: new Date().toISOString(),
      },
      ctx.db,
    );

    completedChunkSet.add(chunk.chunkKey);
    ctx.experiment.checkpoint.completedChunkKeys.push(chunk.chunkKey);
    await ctx.saveCheckpoint();

    completedChunkCountRef.value += 1;
    ctx.emit({
      type: 'progress',
      experimentId: ctx.experiment.id,
      phase: 'phase2_extract',
      completed: completedChunkCountRef.value,
      total: Math.max(totalChunkEstimate, completedChunkCountRef.value),
      detail: `${doc.fileName} Chunk ${chunk.chunkIndex + 1}/${chunks.length}`,
      timestamp: new Date().toISOString(),
    });

    if (deferredBudgetError) {
      throw deferredBudgetError;
    }
  }

  // Book consolidation when document had > 1 chunk and > 4 extracted items
  if (chunks.length > 1) {
    if (domain === 'biology' && mechanisms.length > 4) {
      await ctx.checkBudgetAndPause();
      mechanisms = await consolidateMechanisms({ ctx, doc, items: mechanisms });
    } else if (domain === 'technology' && problems.length > 4) {
      await ctx.checkBudgetAndPause();
      problems = await consolidateProblems({ ctx, doc, items: problems });
    }
  }

  const finalRecord: ExtractionCacheRecord = {
    cacheKey,
    documentId: doc.id,
    domain,
    contentHash: doc.contentHash,
    extractionConfigHash,
    promptHash,
    outputLanguage: config.outputLanguage,
    ...(domain === 'biology' ? { mechanisms } : { problems }),
    createdAt: new Date().toISOString(),
  };

  await saveExtractionCache(finalRecord, ctx.db);
  await deleteExtractionCache(interimKey, ctx.db);

  return { mechanisms, problems, cacheHit: false };
}

/**
 * Loads cached Phase 2 extraction outputs for resume when already past phase2_extract.
 */
export async function loadCachedKnowledgeForExperiment(
  ctx: PipelineRuntimeContext,
  biologyDocs: SourceDocument[],
  technologyDocs: SourceDocument[],
): Promise<Phase2ExtractResult> {
  const { config } = ctx.experiment;
  const extractionConfigHash = await computeExtractionConfigHash(config);
  const promptHash = await computePromptProfileHash(config.promptProfileSnapshot);

  const mechanisms: ExtractedMechanism[] = [];
  const problems: ExtractedProblem[] = [];
  const cacheHits: string[] = [];

  for (const doc of biologyDocs) {
    const { cacheKey } = await computeDocExtractionCacheKey(doc, config, {
      extractionConfigHash,
      promptHash,
    });
    const cached = await getCachedExtraction(cacheKey, ctx.db);
    if (cached?.mechanisms) {
      mechanisms.push(...cached.mechanisms);
      cacheHits.push(doc.id);
    }
  }

  for (const doc of technologyDocs) {
    const { cacheKey } = await computeDocExtractionCacheKey(doc, config, {
      extractionConfigHash,
      promptHash,
    });
    const cached = await getCachedExtraction(cacheKey, ctx.db);
    if (cached?.problems) {
      problems.push(...cached.problems);
      cacheHits.push(doc.id);
    }
  }

  return { mechanisms, problems, cacheHits };
}

/**
 * Phase 2: Strictly isolated blind extraction of Biology (Domain A) and
 * Technology (Domain B) with deterministic citation verification, self-correction,
 * book consolidation, and cache persistence.
 */
export async function runPhase2BlindExtract(
  ctx: PipelineRuntimeContext,
  biologyDocs: SourceDocument[],
  technologyDocs: SourceDocument[],
): Promise<Phase2ExtractResult> {
  const { config } = ctx.experiment;
  const extractionConfigHash = await computeExtractionConfigHash(config);
  const promptHash = await computePromptProfileHash(config.promptProfileSnapshot);

  let estimatedTotalChunks = 0;
  for (const doc of [...biologyDocs, ...technologyDocs]) {
    const pages = await getPagesForDocument(doc.id, ctx.db);
    estimatedTotalChunks += Math.max(1, chunkDocumentPages(doc, pages).length);
  }

  const completedChunkCountRef = { value: 0 };
  const mechanisms: ExtractedMechanism[] = [];
  const problems: ExtractedProblem[] = [];
  const cacheHits: string[] = [];

  // Strict Domain A (Biology) extraction pass
  for (const doc of biologyDocs) {
    const res = await extractDocumentForDomain({
      ctx,
      doc,
      domain: 'biology',
      extractionConfigHash,
      promptHash,
      completedChunkCountRef,
      totalChunkEstimate: estimatedTotalChunks,
    });
    mechanisms.push(...res.mechanisms);
    if (res.cacheHit) {
      cacheHits.push(doc.id);
    }
  }

  // Strict Domain B (Technology) extraction pass
  for (const doc of technologyDocs) {
    const res = await extractDocumentForDomain({
      ctx,
      doc,
      domain: 'technology',
      extractionConfigHash,
      promptHash,
      completedChunkCountRef,
      totalChunkEstimate: estimatedTotalChunks,
    });
    problems.push(...res.problems);
    if (res.cacheHit) {
      cacheHits.push(doc.id);
    }
  }

  return { mechanisms, problems, cacheHits };
}
