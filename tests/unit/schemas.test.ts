import { describe, expect, it } from 'vitest';
import {
  BioBridgeProjectBundleSchema,
  CitationSchema,
  CriticReviewSchema,
  CrossingCandidateSchema,
  DocumentChunkSchema,
  ExperimentRunSchema,
  ExtractedMechanismSchema,
  ExtractedProblemSchema,
  PromptProfileSchema,
  PromptSlotIdSchema,
  SourceDocumentSchema,
} from '@/core/schemas';

const makeCitation = (id: string) => ({
  id,
  documentId: 'doc-1',
  documentTitle: 'Test Paper',
  pageNumber: 3,
  sectionPath: '2.1 Mechanism',
  quoteOriginal: 'The surface microstructure reduces hydrodynamic drag by 18 percent.',
  contextBefore: 'In turbulent flow regimes,',
  contextAfter: 'compared to smooth reference plates.',
  verification: {
    status: 'VERIFIED_EXACT' as const,
    matchScore: 1,
    matchedPageNumber: 3,
    attempts: 1,
  },
});

const makePromptProfile = () => {
  const slotIds = PromptSlotIdSchema.options;
  const slots = Object.fromEntries(
    slotIds.map((id) => [
      id,
      {
        id,
        title: `Slot ${id}`,
        description: 'Description',
        phase: 'phase2',
        riskHint: 'Keep JSON contract intact',
        editableSystemInstruction: 'Follow scientific rigor.',
        lockedOutputContract: '{"type":"object"}',
        requiredVariables: ['{{outputLanguage}}'],
      },
    ]),
  );
  return {
    id: 'default-profile',
    name: 'Standard',
    isDefault: true,
    slots,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
};

describe('Core Zod Schemas', () => {
  it('validates SourceDocument and DocumentChunk', () => {
    const doc = SourceDocumentSchema.parse({
      id: 'doc-1',
      domain: 'biology',
      fileName: 'shark-skin.pdf',
      mimeType: 'application/pdf',
      format: 'pdf',
      contentHash: 'abc123',
      fileSizeBytes: 102400,
      pageCount: 12,
      detectedLanguage: 'en',
      stats: {
        totalChars: 24000,
        estimatedTokens: 6000,
        detectedFigurePages: [2, 5],
        detectedMathAnomalyPages: [4],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(doc.domain).toBe('biology');

    const chunk = DocumentChunkSchema.parse({
      chunkKey: 'doc-1#0',
      documentId: 'doc-1',
      domain: 'biology',
      chunkIndex: 0,
      startPage: 1,
      endPage: 3,
      sectionPath: ['1. Introduction'],
      text: 'Sample chunk text',
      estimatedTokens: 120,
    });
    expect(chunk.chunkIndex).toBe(0);
  });

  it('validates ExtractedMechanism, ExtractedProblem, and rejects empty citations', () => {
    const mechanism = ExtractedMechanismSchema.parse({
      id: 'mech-1',
      sourceDocumentIds: ['doc-1'],
      title: 'Riblet Drag Reduction',
      biologicalSystem: 'Shark dermal denticles',
      structure: 'Micro-grooved longitudinal riblets',
      workingPrinciple: 'Lifts streamwise vortices away from the wall',
      achievedEffect: 'Reduces turbulent skin friction',
      boundaryConditions: {
        spatialScale: '10-100 um',
        timeScale: 'ms',
        medium: 'Water',
        energyForm: 'Hydrodynamic',
        operatingConstraints: 'Re > 1e5',
        faultTolerance: 'Self-cleaning',
      },
      functionalAbstract: 'Passive boundary-layer vortex control via micro-grooves',
      citations: [makeCitation('cit-1')],
    });
    expect(mechanism.citations).toHaveLength(1);

    expect(() =>
      ExtractedMechanismSchema.parse({
        ...mechanism,
        citations: [],
      }),
    ).toThrow();

    const problem = ExtractedProblemSchema.parse({
      id: 'prob-1',
      sourceDocumentIds: ['doc-2'],
      title: 'Pipeline Pumping Loss',
      technicalDomain: 'Fluid Engineering',
      problemStatement: 'High wall shear stress in coolant pipes',
      coreBottleneck: 'Turbulent boundary layer momentum transfer',
      targetMetrics: '>10% pressure drop reduction',
      currentApproachesAndLimits: 'Polymer additives degrade under shear',
      boundaryConditions: {
        spatialScale: 'mm-m',
        timeScale: 'continuous',
        medium: 'Water-glycol',
        energyForm: 'Mechanical pumping',
        operatingConstraints: '60-90 C',
        reliabilityRequirements: '10 years maintenance-free',
      },
      functionalNeedAbstract: 'Passive wall-shear reduction in turbulent internal flow',
      citations: [makeCitation('cit-2')],
    });
    expect(problem.technicalDomain).toBe('Fluid Engineering');
  });

  it('validates CrossingCandidate and CriticReview (enforcing non-empty counterarguments)', () => {
    const candidate = CrossingCandidateSchema.parse({
      id: 'cand-1',
      experimentId: 'exp-1',
      mechanismId: 'mech-1',
      problemId: 'prob-1',
      strategyUsed: 'embedding-hybrid',
      similarityScore: 0.84,
      distanceBand: 'balanced',
      bridgeTitle: 'Micro-riblet inner pipe lining',
      abstractTransferLogic: 'Riblets restrict cross-stream vortex translation',
      proposedImplementationSketch: 'Laser-textured polymer liner',
      keyAssumptions: ['Fouling remains low'],
      potentialFailureModes: ['Scale deposition'],
      mechanismCitationIds: ['cit-1'],
      problemCitationIds: ['cit-2'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(candidate.strategyUsed).toBe('embedding-hybrid');

    const review = CriticReviewSchema.parse({
      candidateId: 'cand-1',
      experimentId: 'exp-1',
      criticModelUsed: 'gemini-2.5-pro',
      scores: {
        mechanismDepth: 3,
        scalabilityAndConstraints: 2,
        technicalValue: 2,
        novelty: 1,
        evidenceQuality: 'PASS',
      },
      weightedTotalScore: 8,
      status: 'PROMISING',
      criticalCounterarguments: ['Biofouling may fill grooves over time.'],
      openHurdles: ['Manufacturing cost for long pipes'],
      verdictSummary: 'Strong physical mechanism with fouling risk.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(review.weightedTotalScore).toBe(8);

    expect(() =>
      CriticReviewSchema.parse({
        ...review,
        criticalCounterarguments: ['   '],
      }),
    ).toThrow();
  });

  it('validates PromptProfile, ExperimentRun, Citation, and BioBridgeProjectBundle', () => {
    const profile = PromptProfileSchema.parse(makePromptProfile());
    const modelAssignment = { provider: 'gemini' as const, modelId: 'gemini-2.5-flash' };

    const experiment = ExperimentRunSchema.parse({
      id: 'exp-1',
      name: 'Drag Reduction Run',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'DRAFT',
      biologyDocIds: ['doc-1'],
      technologyDocIds: ['doc-2'],
      config: {
        outputLanguage: 'de',
        crossingStrategy: 'embedding-hybrid',
        creativityDistance: 0.5,
        distanceBand: 'balanced',
        maxCandidates: 20,
        includeDiagrams: true,
        pdfMathVisionMode: 'auto',
        modelAssignments: {
          extraction: modelAssignment,
          vision: modelAssignment,
          embedding: { provider: 'gemini', modelId: 'text-embedding-004' },
          crossing: modelAssignment,
          critic: modelAssignment,
        },
        weights: {
          mechanismDepth: 1,
          scalabilityAndConstraints: 1,
          technicalValue: 1,
          novelty: 1,
        },
        promptProfileSnapshot: profile,
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
    });

    const bundle = BioBridgeProjectBundleSchema.parse({
      schemaVersion: '1.0.0',
      exportedAt: '2026-01-01T00:00:00.000Z',
      experiment,
      documents: [],
      parsedPages: [],
      mechanisms: [],
      problems: [],
      candidates: [],
      reviews: [],
    });

    expect(bundle.schemaVersion).toBe('1.0.0');
    expect(() => CitationSchema.parse({ ...makeCitation('c'), verification: { ...makeCitation('c').verification, matchScore: 1.5 } })).toThrow();
  });
});
