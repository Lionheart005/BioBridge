import type {
  CostEstimate,
  CostRange,
  ReasoningEffort,
  RunConfig,
  SourceDocument,
} from '@/core/schemas';
import {
  DEFAULT_USD_TO_EUR_RATE,
  getModelPricing,
  type ModelPricing,
  type PricingOverrideMap,
} from './pricingCatalog';
import { estimateVisionTokensPerPage } from './tokenizer';

export interface CostEstimationInput {
  biologyDocs: SourceDocument[];
  technologyDocs: SourceDocument[];
  cachedDocumentIds: string[];
  config: RunConfig;
  pricingOverrides?: PricingOverrideMap;
  usdToEurRate?: number;
}

const CHARS_PER_CHUNK_TARGET = 14_000; // ~3,500 tokens
const EXTRACTION_PROMPT_OVERHEAD_TOKENS = 750;
const VISION_PROMPT_OVERHEAD_TOKENS = 300;
const CONSOLIDATION_PROMPT_OVERHEAD_TOKENS = 600;
const CROSSING_PAIR_INPUT_TOKENS = 420;
const CROSSING_PROMPT_OVERHEAD_TOKENS = 700;
const CRITIC_INPUT_TOKENS_PER_CANDIDATE = 1900;
const CRITIC_PROMPT_OVERHEAD_TOKENS = 850;
const CRITIC_RETRY_BUFFER_FACTOR = 1.2; // +20% worst-case retry buffer (15-25%)

const REASONING_OUTPUT_MULTIPLIER: Record<ReasoningEffort, number> = {
  low: 0.85,
  medium: 1.0,
  high: 1.35,
  extreme: 1.85,
};

function getReasoningOutputMultiplier(effort?: ReasoningEffort): number {
  return effort ? REASONING_OUTPUT_MULTIPLIER[effort] : 1.0;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function tokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1MUsd;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1MUsd;
  return inputCost + outputCost;
}

function collectVisionPagesForDoc(
  doc: SourceDocument,
  config: RunConfig,
): number {
  const pages = new Set<number>();

  if (config.includeDiagrams) {
    for (const p of doc.stats.detectedFigurePages) {
      pages.add(p);
    }
  }

  if (doc.format === 'pdf') {
    if (config.pdfMathVisionMode === 'always') {
      for (let p = 1; p <= doc.pageCount; p += 1) {
        pages.add(p);
      }
    } else if (config.pdfMathVisionMode === 'auto') {
      for (const p of doc.stats.detectedMathAnomalyPages) {
        pages.add(p);
      }
    }
  }

  return pages.size;
}

function estimateDocTokens(doc: SourceDocument): number {
  if (doc.stats.estimatedTokens > 0) {
    return doc.stats.estimatedTokens;
  }
  return Math.max(1, Math.ceil(doc.stats.totalChars / 4));
}

function estimateItemCountFromTokens(totalTokens: number, docCount: number): number {
  if (docCount === 0 || totalTokens === 0) {
    return 0;
  }
  return Math.max(docCount * 2, Math.min(250, Math.round(totalTokens / 1200)));
}

function createZeroRange(): CostRange {
  return {
    minUsd: 0,
    expectedUsd: 0,
    maxUsd: 0,
    estimatedTokens: 0,
  };
}

function sumRanges(ranges: CostRange[]): CostRange {
  return {
    minUsd: roundUsd(ranges.reduce((s, r) => s + r.minUsd, 0)),
    expectedUsd: roundUsd(ranges.reduce((s, r) => s + r.expectedUsd, 0)),
    maxUsd: roundUsd(ranges.reduce((s, r) => s + r.maxUsd, 0)),
    estimatedTokens: ranges.reduce((s, r) => s + r.estimatedTokens, 0),
  };
}

export function estimateExperimentCost(
  input: CostEstimationInput,
): CostEstimate {
  const allDocs = [...input.biologyDocs, ...input.technologyDocs];
  const cachedSet = new Set(input.cachedDocumentIds);
  const uncachedDocs = allDocs.filter((doc) => !cachedSet.has(doc.id));
  const usedCachedIds = allDocs
    .filter((doc) => cachedSet.has(doc.id))
    .map((doc) => doc.id);

  const usdToEurRate = input.usdToEurRate ?? DEFAULT_USD_TO_EUR_RATE;

  // --- Phase 1b: Vision (only uncached docs!) ---
  const visionAssignment = input.config.modelAssignments.vision;
  const visionPricing = getModelPricing(
    visionAssignment.provider,
    visionAssignment.modelId,
    input.pricingOverrides,
  );

  let visionPageCount = 0;
  for (const doc of uncachedDocs) {
    visionPageCount += collectVisionPagesForDoc(doc, input.config);
  }

  let phase1Vision: CostRange = createZeroRange();
  if (visionPageCount > 0) {
    const tokensPerImage = estimateVisionTokensPerPage();
    const inputPerPage = tokensPerImage + VISION_PROMPT_OVERHEAD_TOKENS;
    const visionOutMult = getReasoningOutputMultiplier(
      visionAssignment.reasoningEffort,
    );
    const minOutTotal = Math.round(visionPageCount * 250 * visionOutMult);
    const expOutTotal = Math.round(visionPageCount * 450 * visionOutMult);
    const maxOutTotal = Math.round(visionPageCount * 750 * visionOutMult);

    const perImageSurcharge =
      visionPageCount * (visionPricing.visionPerImageUsd ?? 0);

    phase1Vision = {
      minUsd: roundUsd(
        tokenCostUsd(
          visionPageCount * inputPerPage,
          minOutTotal,
          visionPricing,
        ) + perImageSurcharge,
      ),
      expectedUsd: roundUsd(
        tokenCostUsd(
          visionPageCount * inputPerPage,
          expOutTotal,
          visionPricing,
        ) + perImageSurcharge,
      ),
      maxUsd: roundUsd(
        tokenCostUsd(
          visionPageCount * inputPerPage,
          maxOutTotal,
          visionPricing,
        ) + perImageSurcharge,
      ),
      estimatedTokens: visionPageCount * inputPerPage + expOutTotal,
    };
  }

  // --- Phase 2: Blind Extraction + Consolidation (0 tokens / $0 for cached docs!) ---
  const extractionAssignment = input.config.modelAssignments.extraction;
  const extractionPricing = getModelPricing(
    extractionAssignment.provider,
    extractionAssignment.modelId,
    input.pricingOverrides,
  );

  let phase2Extract: CostRange = createZeroRange();
  let totalChunks = 0;
  let consolidationCalls = 0;

  if (uncachedDocs.length > 0) {
    let totalDocTokens = 0;
    for (const doc of uncachedDocs) {
      const docTokens = estimateDocTokens(doc);
      totalDocTokens += docTokens;
      const chunksForDoc = Math.max(
        1,
        Math.ceil(Math.max(doc.stats.totalChars, docTokens * 4) / CHARS_PER_CHUNK_TARGET),
      );
      totalChunks += chunksForDoc;
      if (chunksForDoc > 1) {
        consolidationCalls += Math.ceil(chunksForDoc / 4);
      }
    }

    const extractInputTokens =
      totalDocTokens + totalChunks * EXTRACTION_PROMPT_OVERHEAD_TOKENS;
    const consolidationInputTokens =
      consolidationCalls * (CONSOLIDATION_PROMPT_OVERHEAD_TOKENS + 1800);
    const totalInput = extractInputTokens + consolidationInputTokens;

    const extractOutMult = getReasoningOutputMultiplier(
      extractionAssignment.reasoningEffort,
    );
    const minOutput = Math.round(
      (totalDocTokens * 0.25 + consolidationCalls * 400) * extractOutMult,
    );
    const expOutput = Math.round(
      (totalDocTokens * 0.4 + consolidationCalls * 750) * extractOutMult,
    );
    const maxOutput = Math.round(
      (totalDocTokens * 0.65 + consolidationCalls * 1200) * extractOutMult,
    );

    phase2Extract = {
      minUsd: roundUsd(tokenCostUsd(totalInput, minOutput, extractionPricing)),
      expectedUsd: roundUsd(tokenCostUsd(totalInput, expOutput, extractionPricing)),
      maxUsd: roundUsd(tokenCostUsd(totalInput, maxOutput, extractionPricing)),
      estimatedTokens: totalInput + expOutput,
    };
  }

  // --- Phase 3: Crossing Engine (uses all uploaded bio & tech docs) ---
  const bioTokens = input.biologyDocs.reduce(
    (sum, doc) => sum + estimateDocTokens(doc),
    0,
  );
  const techTokens = input.technologyDocs.reduce(
    (sum, doc) => sum + estimateDocTokens(doc),
    0,
  );

  const bioItems = estimateItemCountFromTokens(
    bioTokens,
    input.biologyDocs.length,
  );
  const techItems = estimateItemCountFromTokens(
    techTokens,
    input.technologyDocs.length,
  );

  const crossingAssignment = input.config.modelAssignments.crossing;
  const crossingPricing = getModelPricing(
    crossingAssignment.provider,
    crossingAssignment.modelId,
    input.pricingOverrides,
  );

  let phase3Cross: CostRange = createZeroRange();
  let phase3Calls = 0;

  if (bioItems > 0 && techItems > 0) {
    const batchSize = 4;
    const crossingBatches = Math.max(
      1,
      Math.ceil(input.config.maxCandidates / batchSize),
    );

    const crossingOutMult = getReasoningOutputMultiplier(
      crossingAssignment.reasoningEffort,
    );

    if (input.config.crossingStrategy === 'embedding-hybrid') {
      const embAssignment = input.config.modelAssignments.embedding;
      const embPricing = getModelPricing(
        embAssignment.provider,
        embAssignment.modelId,
        input.pricingOverrides,
      );

      const embeddingTokens = (bioItems + techItems) * 160;
      const embRate =
        embPricing.embeddingPer1MUsd ?? embPricing.inputPer1MUsd;
      const embeddingCostUsd = (embeddingTokens / 1_000_000) * embRate;

      const crossInputTokens =
        crossingBatches * CROSSING_PROMPT_OVERHEAD_TOKENS +
        input.config.maxCandidates * CROSSING_PAIR_INPUT_TOKENS;
      const minOut = Math.round(input.config.maxCandidates * 240 * crossingOutMult);
      const expOut = Math.round(input.config.maxCandidates * 380 * crossingOutMult);
      const maxOut = Math.round(input.config.maxCandidates * 560 * crossingOutMult);

      phase3Cross = {
        minUsd: roundUsd(
          embeddingCostUsd +
            tokenCostUsd(crossInputTokens, minOut, crossingPricing),
        ),
        expectedUsd: roundUsd(
          embeddingCostUsd +
            tokenCostUsd(crossInputTokens, expOut, crossingPricing),
        ),
        maxUsd: roundUsd(
          embeddingCostUsd +
            tokenCostUsd(crossInputTokens, maxOut, crossingPricing),
        ),
        estimatedTokens: embeddingTokens + crossInputTokens + expOut,
      };
      phase3Calls = 2 + crossingBatches;
    } else {
      // cluster-batch: 2 clustering calls + 1 cluster-matrix call + batch crossing calls
      const clusterInputTokens =
        (bioItems + techItems) * 140 + 2 * 900 + 1800;
      const clusterOutputTokens = 2 * 900 + 800;

      const crossBatches = Math.max(
        crossingBatches,
        Math.ceil(input.config.maxCandidates / 3),
      );
      const crossInputTokens =
        crossBatches * (CROSSING_PROMPT_OVERHEAD_TOKENS + 300) +
        input.config.maxCandidates * (CROSSING_PAIR_INPUT_TOKENS + 140);

      const totalInput = clusterInputTokens + crossInputTokens;
      const minOut = Math.round(
        (clusterOutputTokens + input.config.maxCandidates * 260) * crossingOutMult,
      );
      const expOut = Math.round(
        (clusterOutputTokens + input.config.maxCandidates * 430) * crossingOutMult,
      );
      const maxOut = Math.round(
        (clusterOutputTokens + input.config.maxCandidates * 650) * crossingOutMult,
      );

      phase3Cross = {
        minUsd: roundUsd(tokenCostUsd(totalInput, minOut, crossingPricing)),
        expectedUsd: roundUsd(tokenCostUsd(totalInput, expOut, crossingPricing)),
        maxUsd: roundUsd(tokenCostUsd(totalInput, maxOut, crossingPricing)),
        estimatedTokens: totalInput + expOut,
      };
      phase3Calls = 3 + crossBatches;
    }
  }

  // --- Phase 4: Advocatus Diaboli + 20% Retry Buffer ---
  const criticAssignment = input.config.modelAssignments.critic;
  const criticPricing = getModelPricing(
    criticAssignment.provider,
    criticAssignment.modelId,
    input.pricingOverrides,
  );

  let phase4Critic: CostRange = createZeroRange();
  let phase4Calls = 0;

  if (bioItems > 0 && techItems > 0 && input.config.maxCandidates > 0) {
    phase4Calls = input.config.maxCandidates;
    const criticInputTokens =
      phase4Calls *
      (CRITIC_INPUT_TOKENS_PER_CANDIDATE + CRITIC_PROMPT_OVERHEAD_TOKENS);
    const criticOutMult = getReasoningOutputMultiplier(
      criticAssignment.reasoningEffort,
    );
    const minOut = Math.round(phase4Calls * 380 * criticOutMult);
    const expOut = Math.round(phase4Calls * 620 * criticOutMult);
    const maxOut = Math.round(phase4Calls * 900 * criticOutMult);

    const baseMaxCost = tokenCostUsd(criticInputTokens, maxOut, criticPricing);

    phase4Critic = {
      minUsd: roundUsd(tokenCostUsd(criticInputTokens, minOut, criticPricing)),
      expectedUsd: roundUsd(
        tokenCostUsd(criticInputTokens, expOut, criticPricing),
      ),
      maxUsd: roundUsd(baseMaxCost * CRITIC_RETRY_BUFFER_FACTOR),
      estimatedTokens: criticInputTokens + expOut,
    };
  }

  const total = sumRanges([
    phase1Vision,
    phase2Extract,
    phase3Cross,
    phase4Critic,
  ]);

  // --- Estimated Duration (Concurrency ~3) ---
  const effectiveConcurrency = 3;
  const totalCalls =
    visionPageCount + totalChunks + consolidationCalls + phase3Calls + phase4Calls;

  const minSec =
    totalCalls === 0
      ? 0
      : Math.max(2, Math.round((totalCalls / effectiveConcurrency) * 1.4));
  const expectedSec =
    totalCalls === 0
      ? 0
      : Math.max(minSec, Math.round((totalCalls / effectiveConcurrency) * 2.8));
  const maxSec =
    totalCalls === 0
      ? 0
      : Math.max(expectedSec, Math.round((totalCalls / effectiveConcurrency) * 5.2));

  return {
    phase1Vision,
    phase2Extract,
    phase3Cross,
    phase4Critic,
    total,
    cachedDocumentIds: usedCachedIds,
    visionPageCount,
    estimatedDurationSec: {
      min: minSec,
      expected: expectedSec,
      max: maxSec,
    },
    usdToEurRate,
    computedAt: new Date().toISOString(),
  };
}
