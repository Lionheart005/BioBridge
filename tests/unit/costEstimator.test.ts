import { describe, expect, it } from 'vitest';
import {
  CostEstimateSchema,
  type RunConfig,
  type SourceDocument,
} from '@/core/schemas';
import {
  DEFAULT_USD_TO_EUR_RATE,
  MODEL_PRESETS,
  PRICING_CATALOG_UPDATED_AT,
  estimateExperimentCost,
  estimateTokenCount,
  estimateVisionTokensPerPage,
  getModelPricing,
} from '@/estimation';
import { createDefaultPromptProfile } from '@/prompts';

function makeDoc(overrides: Partial<SourceDocument> = {}): SourceDocument {
  return {
    id: 'doc-bio-1',
    domain: 'biology',
    fileName: 'ants.pdf',
    mimeType: 'application/pdf',
    format: 'pdf',
    contentHash: 'hash-bio-1',
    fileSizeBytes: 500_000,
    pageCount: 20,
    detectedLanguage: 'en',
    stats: {
      totalChars: 60_000,
      estimatedTokens: 15_000,
      detectedFigurePages: [3, 7, 12],
      detectedMathAnomalyPages: [7, 15],
    },
    createdAt: '2026-11-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    outputLanguage: 'de',
    crossingStrategy: 'embedding-hybrid',
    creativityDistance: 0.5,
    distanceBand: 'balanced',
    maxCandidates: 24,
    includeDiagrams: true,
    pdfMathVisionMode: 'auto',
    modelAssignments: MODEL_PRESETS.balanced.assignments,
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

describe('Tokenizer & Pricing Catalog', () => {
  it('estimates tokens for prose, LaTeX, and vision pages reasonably', () => {
    expect(estimateTokenCount('')).toBe(0);
    const proseTokens = estimateTokenCount(
      'Donaudampfschifffahrtsgesellschaftskapitän untersucht Turgordruckbewegungen.',
    );
    expect(proseTokens).toBeGreaterThan(8);

    const latexTokens = estimateTokenCount(
      '$$\\frac{\\partial u}{\\partial t} + u \\cdot \\nabla u = -\\frac{1}{\\rho} \\nabla p + \\nu \\nabla^2 u$$',
    );
    expect(latexTokens).toBeGreaterThan(20);
    expect(estimateVisionTokensPerPage()).toBe(1100);
  });

  it('exposes pricing catalog metadata, presets, and overrides', () => {
    expect(PRICING_CATALOG_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DEFAULT_USD_TO_EUR_RATE).toBe(0.92);

    const customPricing = getModelPricing('custom', 'llama3.1');
    expect(customPricing.inputPer1MUsd).toBe(0);

    const overridden = getModelPricing('gemini', 'gemini-2.5-flash', {
      'gemini:gemini-2.5-flash': { inputPer1MUsd: 0.25 },
    });
    expect(overridden.inputPer1MUsd).toBe(0.25);

    const hydrogen = getModelPricing('gemini', 'gemini-4-hydrogen');
    expect(hydrogen.inputPer1MUsd).toBe(1.5);
    expect(hydrogen.outputPer1MUsd).toBe(7.5);
    expect(hydrogen.supportsVision).toBe(true);

    const neon = getModelPricing('gemini', 'gemini-4-neon');
    expect(neon.inputPer1MUsd).toBe(3.0);
    expect(neon.outputPer1MUsd).toBe(15.0);
    expect(neon.supportsVision).toBe(true);

    const opus = getModelPricing('anthropic', 'claude-opus-5-5');
    expect(opus.inputPer1MUsd).toBe(4.0);
    expect(opus.outputPer1MUsd).toBe(20.0);
    expect(opus.supportsVision).toBe(true);

    const sonnet = getModelPricing('anthropic', 'claude-sonnet-5-5');
    expect(sonnet.inputPer1MUsd).toBe(2.0);
    expect(sonnet.outputPer1MUsd).toBe(10.0);
    expect(sonnet.supportsVision).toBe(true);

    const deepseekPro = getModelPricing('deepseek', 'deepseek-v4-pro');
    expect(deepseekPro.inputPer1MUsd).toBe(1.32);
    expect(deepseekPro.outputPer1MUsd).toBe(3.96);
    expect(deepseekPro.supportsVision).toBe(false);

    const deepseekFlash = getModelPricing('deepseek', 'deepseek-flash');
    expect(deepseekFlash.inputPer1MUsd).toBe(0.3);
    expect(deepseekFlash.outputPer1MUsd).toBe(1.2);
    expect(deepseekFlash.supportsVision).toBe(false);
  });
});

describe('estimateExperimentCost', () => {
  it('computes min <= expected <= max and validates against CostEstimateSchema', () => {
    const bioDoc = makeDoc({ id: 'bio-1', domain: 'biology' });
    const techDoc = makeDoc({
      id: 'tech-1',
      domain: 'technology',
      fileName: 'servers.pdf',
    });

    const estimate = estimateExperimentCost({
      biologyDocs: [bioDoc],
      technologyDocs: [techDoc],
      cachedDocumentIds: [],
      config: makeConfig(),
    });

    expect(() => CostEstimateSchema.parse(estimate)).not.toThrow();

    for (const phase of [
      estimate.phase1Vision,
      estimate.phase2Extract,
      estimate.phase3Cross,
      estimate.phase4Critic,
      estimate.total,
    ]) {
      expect(phase.minUsd).toBeLessThanOrEqual(phase.expectedUsd);
      expect(phase.expectedUsd).toBeLessThanOrEqual(phase.maxUsd);
    }

    // Deduplicated pages: [3, 7, 12] U [7, 15] = 4 pages per doc -> 8 pages total
    expect(estimate.visionPageCount).toBe(8);
    expect(estimate.phase1Vision.expectedUsd).toBeGreaterThan(0);
    expect(estimate.phase2Extract.expectedUsd).toBeGreaterThan(0);
    expect(estimate.estimatedDurationSec.min).toBeLessThanOrEqual(
      estimate.estimatedDurationSec.expected,
    );
    expect(estimate.estimatedDurationSec.expected).toBeLessThanOrEqual(
      estimate.estimatedDurationSec.max,
    );
  });

  it('returns $0 / 0 tokens for phase1Vision and phase2Extract when all documents are cached', () => {
    const bioDoc = makeDoc({ id: 'bio-1', domain: 'biology' });
    const techDoc = makeDoc({ id: 'tech-1', domain: 'technology' });

    const estimate = estimateExperimentCost({
      biologyDocs: [bioDoc],
      technologyDocs: [techDoc],
      cachedDocumentIds: ['bio-1', 'tech-1'],
      config: makeConfig(),
    });

    expect(estimate.cachedDocumentIds).toEqual(['bio-1', 'tech-1']);
    expect(estimate.visionPageCount).toBe(0);
    expect(estimate.phase1Vision.expectedUsd).toBe(0);
    expect(estimate.phase1Vision.estimatedTokens).toBe(0);
    expect(estimate.phase2Extract.expectedUsd).toBe(0);
    expect(estimate.phase2Extract.estimatedTokens).toBe(0);
    // Crossing & critic still run on the cached knowledge items
    expect(estimate.phase3Cross.expectedUsd).toBeGreaterThan(0);
    expect(estimate.phase4Critic.expectedUsd).toBeGreaterThan(0);
  });

  it('reflects vision toggles (off vs auto vs always) and crossing strategy differences', () => {
    const bioDoc = makeDoc({ id: 'bio-1', domain: 'biology', pageCount: 15 });
    const techDoc = makeDoc({ id: 'tech-1', domain: 'technology', pageCount: 15 });

    const noVision = estimateExperimentCost({
      biologyDocs: [bioDoc],
      technologyDocs: [techDoc],
      cachedDocumentIds: [],
      config: makeConfig({
        includeDiagrams: false,
        pdfMathVisionMode: 'off',
      }),
    });
    expect(noVision.visionPageCount).toBe(0);
    expect(noVision.phase1Vision.expectedUsd).toBe(0);

    const alwaysVision = estimateExperimentCost({
      biologyDocs: [bioDoc],
      technologyDocs: [techDoc],
      cachedDocumentIds: [],
      config: makeConfig({
        includeDiagrams: true,
        pdfMathVisionMode: 'always',
      }),
    });
    expect(alwaysVision.visionPageCount).toBe(30);
    expect(alwaysVision.phase1Vision.expectedUsd).toBeGreaterThan(
      noVision.phase1Vision.expectedUsd,
    );

    const hybridEst = estimateExperimentCost({
      biologyDocs: [bioDoc],
      technologyDocs: [techDoc],
      cachedDocumentIds: ['bio-1', 'tech-1'],
      config: makeConfig({ crossingStrategy: 'embedding-hybrid' }),
    });

    const clusterEst = estimateExperimentCost({
      biologyDocs: [bioDoc],
      technologyDocs: [techDoc],
      cachedDocumentIds: ['bio-1', 'tech-1'],
      config: makeConfig({ crossingStrategy: 'cluster-batch' }),
    });

    expect(clusterEst.phase3Cross.estimatedTokens).toBeGreaterThan(
      hybridEst.phase3Cross.estimatedTokens,
    );
    expect(clusterEst.phase3Cross.expectedUsd).toBeGreaterThan(
      hybridEst.phase3Cross.expectedUsd,
    );
  });

  it('scales estimated output tokens and cost higher for extreme reasoningEffort than low', () => {
    const bioDoc = makeDoc({ id: 'bio-1', domain: 'biology' });
    const techDoc = makeDoc({
      id: 'tech-1',
      domain: 'technology',
      fileName: 'servers.pdf',
    });

    const lowConfig = makeConfig({
      modelAssignments: {
        extraction: {
          provider: 'gemini',
          modelId: 'gemini-4-hydrogen',
          temperature: 0.1,
          reasoningEffort: 'low',
        },
        vision: {
          provider: 'gemini',
          modelId: 'gemini-4-hydrogen',
          temperature: 0.1,
          reasoningEffort: 'low',
        },
        embedding: { provider: 'gemini', modelId: 'text-embedding-004' },
        crossing: {
          provider: 'gemini',
          modelId: 'gemini-4-neon',
          temperature: 0.4,
          reasoningEffort: 'low',
        },
        critic: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-5-5',
          temperature: 0.1,
          reasoningEffort: 'low',
        },
      },
    });

    const extremeConfig = makeConfig({
      modelAssignments: {
        extraction: {
          provider: 'gemini',
          modelId: 'gemini-4-hydrogen',
          temperature: 0.1,
          reasoningEffort: 'extreme',
        },
        vision: {
          provider: 'gemini',
          modelId: 'gemini-4-hydrogen',
          temperature: 0.1,
          reasoningEffort: 'extreme',
        },
        embedding: { provider: 'gemini', modelId: 'text-embedding-004' },
        crossing: {
          provider: 'gemini',
          modelId: 'gemini-4-neon',
          temperature: 0.4,
          reasoningEffort: 'extreme',
        },
        critic: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-5-5',
          temperature: 0.1,
          reasoningEffort: 'extreme',
        },
      },
    });

    const lowEst = estimateExperimentCost({
      biologyDocs: [bioDoc],
      technologyDocs: [techDoc],
      cachedDocumentIds: [],
      config: lowConfig,
    });

    const extremeEst = estimateExperimentCost({
      biologyDocs: [bioDoc],
      technologyDocs: [techDoc],
      cachedDocumentIds: [],
      config: extremeConfig,
    });

    expect(() => CostEstimateSchema.parse(lowEst)).not.toThrow();
    expect(() => CostEstimateSchema.parse(extremeEst)).not.toThrow();
    expect(extremeEst.phase1Vision.expectedUsd).toBeGreaterThan(
      lowEst.phase1Vision.expectedUsd,
    );
    expect(extremeEst.phase2Extract.expectedUsd).toBeGreaterThan(
      lowEst.phase2Extract.expectedUsd,
    );
    expect(extremeEst.phase3Cross.expectedUsd).toBeGreaterThan(
      lowEst.phase3Cross.expectedUsd,
    );
    expect(extremeEst.phase4Critic.expectedUsd).toBeGreaterThan(
      lowEst.phase4Critic.expectedUsd,
    );
    expect(extremeEst.total.expectedUsd).toBeGreaterThan(
      lowEst.total.expectedUsd,
    );
  });
});
