import { z } from 'zod';
import { requestStructuredOutput, type UsageReceipt } from '@/ai';
import type {
  ParsedBlock,
  ParsedPage,
  RunConfig,
  SourceDocument,
} from '@/core/schemas';
import { hashJsonStable } from '@/core/utils/hash';
import {
  VISION_EXTRACT_PROMPT,
  compilePrompt,
  computePromptProfileHash,
} from '@/prompts';
import {
  buildExtractionCacheKey,
  getCachedExtraction,
  getPagesForDocument,
  updateParsedPage,
} from '@/storage';
import type { PipelineRuntimeContext } from '../orchestrator';
import { BudgetLimitExceededError } from '../strategies/crossingStrategy.interface';

const VisionFigureSchema = z.object({
  figureRef: z.string(),
  captionOrTitle: z.string(),
  mechanismOrContentSummary: z.string(),
  keyQuantitiesAndUnits: z.array(z.string()),
});

const VisionFormulaSchema = z.object({
  contextLabel: z.string(),
  latex: z.string(),
});

const VisionExtractOutputSchema = z.object({
  pageNumber: z.number().int().min(1),
  figures: z.array(VisionFigureSchema),
  reconstructedFormulas: z.array(VisionFormulaSchema),
  consolidatedPageSupplement: z.string(),
});

type VisionExtractOutput = z.infer<typeof VisionExtractOutputSchema>;

function shouldAnalyzePage(
  doc: SourceDocument,
  page: ParsedPage,
  config: RunConfig,
): boolean {
  if (config.includeDiagrams && page.hasDiagram) {
    return true;
  }
  if (doc.format === 'pdf') {
    if (config.pdfMathVisionMode === 'always') {
      return true;
    }
    if (config.pdfMathVisionMode === 'auto' && page.hasMathAnomaly) {
      return true;
    }
  }
  return false;
}

function buildVisionBlocks(
  docId: string,
  pageNumber: number,
  output: VisionExtractOutput,
): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  output.figures.forEach((fig, idx) => {
    const quantities =
      fig.keyQuantitiesAndUnits.length > 0
        ? ` [${fig.keyQuantitiesAndUnits.join('; ')}]`
        : '';
    const prefix = fig.captionOrTitle.trim() ? `${fig.captionOrTitle.trim()}: ` : '';
    blocks.push({
      id: `${docId}:p:${pageNumber}:vision_fig:${idx}`,
      type: 'figure_vision',
      figureRef: fig.figureRef.trim() || undefined,
      content: `${prefix}${fig.mechanismOrContentSummary.trim()}${quantities}`.trim(),
    });
  });

  output.reconstructedFormulas.forEach((formula, idx) => {
    const label = formula.contextLabel.trim();
    const latex = formula.latex.trim();
    blocks.push({
      id: `${docId}:p:${pageNumber}:vision_formula:${idx}`,
      type: 'formula',
      content: label ? `${label}: ${latex}` : latex,
      latex,
    });
  });

  return blocks;
}

function buildVisionSupplementText(
  pageNumber: number,
  output: VisionExtractOutput,
): string {
  const lines: string[] = [];
  if (output.consolidatedPageSupplement.trim()) {
    lines.push(output.consolidatedPageSupplement.trim());
  }
  for (const fig of output.figures) {
    const ref = fig.figureRef.trim() ? `[${fig.figureRef.trim()}] ` : '';
    const title = fig.captionOrTitle.trim() ? `${fig.captionOrTitle.trim()}: ` : '';
    const summary = fig.mechanismOrContentSummary.trim();
    const units =
      fig.keyQuantitiesAndUnits.length > 0
        ? ` (${fig.keyQuantitiesAndUnits.join(', ')})`
        : '';
    const line = `${ref}${title}${summary}${units}`.trim();
    if (line && !output.consolidatedPageSupplement.includes(line)) {
      lines.push(line);
    }
  }
  for (const formula of output.reconstructedFormulas) {
    const latex = formula.latex.trim();
    if (latex && !output.consolidatedPageSupplement.includes(latex)) {
      const label = formula.contextLabel.trim();
      lines.push(label ? `${label}: ${latex}` : latex);
    }
  }

  if (lines.length === 0) {
    return '';
  }

  return `[Vision Supplement p.${pageNumber}]\n${lines.join('\n')}`;
}

export interface Phase1VisionResult {
  analyzedPages: number;
  skippedPages: number;
}

/**
 * Phase 1b: Optional vision enrichment for diagrams and PDF math anomalies
 * on uncached documents.
 */
export async function runPhase1VisionEnrich(
  ctx: PipelineRuntimeContext,
  docs: SourceDocument[],
): Promise<Phase1VisionResult> {
  const { config } = ctx.experiment;
  const needsAnyVision =
    config.includeDiagrams || config.pdfMathVisionMode !== 'off';

  if (!needsAnyVision || docs.length === 0) {
    return { analyzedPages: 0, skippedPages: 0 };
  }

  const extractionConfigHash = await hashJsonStable({
    extraction: config.modelAssignments.extraction,
    vision: config.modelAssignments.vision,
    includeDiagrams: config.includeDiagrams,
    pdfMathVisionMode: config.pdfMathVisionMode,
  });
  const promptHash = await computePromptProfileHash(config.promptProfileSnapshot);

  const completedSet = new Set(ctx.experiment.checkpoint.completedVisionPageKeys);
  const targets: Array<{ doc: SourceDocument; page: ParsedPage; key: string }> = [];

  for (const doc of docs) {
    const cacheKey = await buildExtractionCacheKey({
      contentHash: doc.contentHash,
      extractionConfigHash,
      promptHash,
      outputLanguage: config.outputLanguage,
    });
    const cached = await getCachedExtraction(cacheKey, ctx.db);
    if (cached) {
      continue;
    }

    const pages = await getPagesForDocument(doc.id, ctx.db);
    for (const page of pages) {
      if (!shouldAnalyzePage(doc, page, config)) {
        continue;
      }
      const key = `${doc.id}:p:${page.pageNumber}`;
      if (!completedSet.has(key)) {
        targets.push({ doc, page, key });
      }
    }
  }

  if (targets.length === 0) {
    return { analyzedPages: 0, skippedPages: 0 };
  }

  if (!ctx.pageImageProvider) {
    ctx.emit({
      type: 'log',
      experimentId: ctx.experiment.id,
      level: 'info',
      phase: 'phase1_vision',
      message: `Vision-Analyse für ${targets.length} Seite(n) übersprungen: Kein Seitenbild-Provider verfügbar.`,
      timestamp: new Date().toISOString(),
    });
    return { analyzedPages: 0, skippedPages: targets.length };
  }

  const visionModel = config.modelAssignments.vision;
  const visionSlot =
    config.promptProfileSnapshot.slots.visionExtract ?? VISION_EXTRACT_PROMPT;

  let analyzedPages = 0;
  let skippedPages = 0;

  for (let i = 0; i < targets.length; i += 1) {
    const { doc, page, key } = targets[i];
    await ctx.checkBudgetAndPause();

    const image = await ctx.pageImageProvider(doc.id, page.pageNumber);
    if (!image) {
      skippedPages += 1;
      ctx.emit({
        type: 'log',
        experimentId: ctx.experiment.id,
        level: 'warn',
        phase: 'phase1_vision',
        message: `Kein Seitenbild für "${doc.fileName}" Seite ${page.pageNumber} verfügbar (übersprungen).`,
        timestamp: new Date().toISOString(),
      });
      ctx.emit({
        type: 'progress',
        experimentId: ctx.experiment.id,
        phase: 'phase1_vision',
        completed: i + 1,
        total: targets.length,
        detail: `${doc.fileName} S.${page.pageNumber} übersprungen`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    const systemPrompt = compilePrompt(visionSlot, {
      OUTPUT_LANGUAGE: config.outputLanguage,
      PAGE_NUMBER: String(page.pageNumber),
    });

    const usageTasks: Promise<void>[] = [];
    let deferredBudgetError: BudgetLimitExceededError | null = null;

    const recordVisionUsage = (usage: UsageReceipt): void => {
      const normalizedUsage: UsageReceipt = {
        ...usage,
        visionImages: usage.visionImages ?? 1,
      };
      const task = ctx
        .recordUsage(
          'phase1_vision',
          'vision',
          visionModel.provider,
          visionModel.modelId,
          normalizedUsage,
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
            provider: visionModel.provider,
            modelId: visionModel.modelId,
            role: 'vision',
            temperature: visionModel.temperature ?? 0.1,
            reasoningEffort: visionModel.reasoningEffort,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  `Dokument: ${doc.fileName}`,
                  `Seite: ${page.pageNumber}`,
                  page.rawNormalizedText.trim()
                    ? `Bisheriger Rohtext-Auszug:\n${page.rawNormalizedText.slice(0, 1500)}`
                    : 'Bisheriger Rohtext: (leer)',
                ].join('\n\n'),
                images: [image],
              },
            ],
            metadata: {
              experimentId: ctx.experiment.id,
              phase: 'phase1_vision',
            },
          },
          schema: VisionExtractOutputSchema,
          schemaName: 'VisionExtractOutput',
          signal: qSignal,
          onUsage: recordVisionUsage,
        }),
      ctx.signal,
    );

    await Promise.all(usageTasks);

    const newBlocks = buildVisionBlocks(doc.id, page.pageNumber, structured.data);
    const supplement = buildVisionSupplementText(page.pageNumber, structured.data);

    const existingBlockIds = new Set(page.blocks.map((b) => b.id));
    const mergedBlocks = [
      ...page.blocks,
      ...newBlocks.filter((b) => !existingBlockIds.has(b.id)),
    ];

    const marker = `[Vision Supplement p.${page.pageNumber}]`;
    const nextRawText =
      supplement && !page.rawNormalizedText.includes(marker)
        ? page.rawNormalizedText.trim().length > 0
          ? `${page.rawNormalizedText.trim()}\n\n${supplement}`
          : supplement
        : page.rawNormalizedText;

    await updateParsedPage(
      {
        ...page,
        blocks: mergedBlocks,
        rawNormalizedText: nextRawText,
      },
      ctx.db,
    );

    if (!completedSet.has(key)) {
      completedSet.add(key);
      ctx.experiment.checkpoint.completedVisionPageKeys.push(key);
    }
    await ctx.saveCheckpoint();
    analyzedPages += 1;

    ctx.emit({
      type: 'progress',
      experimentId: ctx.experiment.id,
      phase: 'phase1_vision',
      completed: i + 1,
      total: targets.length,
      detail: `${doc.fileName} S.${page.pageNumber}`,
      timestamp: new Date().toISOString(),
    });

    if (deferredBudgetError) {
      throw deferredBudgetError;
    }
  }

  return { analyzedPages, skippedPages };
}
