import { describe, expect, it } from 'vitest';
import type {
  Citation,
  CriticReview,
  CrossingCandidate,
  ExtractedMechanism,
  ExtractedProblem,
  ExtractionCacheRecord,
  VerificationStatus,
} from '@/core/schemas';
import {
  DEFAULT_MATRIX_FILTER_STATE,
  VERDICT_META,
  buildMatrixRows,
  computeMatrixSummary,
  filterAndSortMatrixRows,
  partitionMatrixRows,
  resolveMechanismsAndProblems,
  type MatrixFilterState,
} from '@/ui/features/matrix/matrixHelpers';

function makeCitation(
  id: string,
  documentId: string,
  status: VerificationStatus = 'VERIFIED_EXACT',
  quoteOriginal = 'Original quote',
): Citation {
  return {
    id,
    documentId,
    documentTitle: `Doc ${documentId}`,
    pageNumber: 3,
    sectionPath: '2.1 Results',
    quoteOriginal,
    quoteTranslation: 'Übersetztes Zitat',
    contextBefore: 'Vorheriger Satz.',
    contextAfter: 'Nachfolgender Satz.',
    verification: {
      status,
      matchScore: status === 'FAILED_UNVERIFIED' ? 0.1 : 0.98,
      matchedPageNumber: 3,
      attempts: status === 'CORRECTED_VERIFIED' ? 2 : 1,
    },
  };
}

function makeMechanism(
  id: string,
  docId: string,
  citations: Citation[],
  title = `Mechanism ${id}`,
): ExtractedMechanism {
  return {
    id,
    sourceDocumentIds: [docId],
    title,
    biologicalSystem: 'Lasius niger',
    structure: 'Pheromone trail network',
    workingPrinciple: 'Positive feedback via volatile markers',
    achievedEffect: 'Shortest-path convergence',
    boundaryConditions: {
      spatialScale: '1 cm - 50 m',
      timeScale: 'seconds',
      medium: 'air',
      energyForm: 'chemical',
      operatingConstraints: 'minimum density',
    },
    functionalAbstract: 'Decentralized path weighting',
    citations,
  };
}

function makeProblem(
  id: string,
  docId: string,
  citations: Citation[],
  title = `Problem ${id}`,
): ExtractedProblem {
  return {
    id,
    sourceDocumentIds: [docId],
    title,
    technicalDomain: 'Distributed Systems',
    problemStatement: 'Load spikes cause stale routing',
    coreBottleneck: 'Centralized health checks lag',
    targetMetrics: 'p99 < 35 ms',
    currentApproachesAndLimits: 'Round-robin ignores load',
    boundaryConditions: {
      spatialScale: 'cluster',
      timeScale: '1-500 ms',
      medium: 'network packets',
      energyForm: 'electrical',
      operatingConstraints: '< 0.2 ms overhead',
    },
    functionalNeedAbstract: 'Local adaptive route weights',
    citations,
  };
}

function makeCandidate(
  overrides: Partial<CrossingCandidate> & Pick<CrossingCandidate, 'id' | 'bridgeTitle'>,
): CrossingCandidate {
  return {
    experimentId: 'exp-1',
    mechanismId: 'mech-1',
    problemId: 'prob-1',
    strategyUsed: 'embedding-hybrid',
    similarityScore: 0.82,
    distanceBand: 'balanced',
    abstractTransferLogic: 'Transfer logic',
    proposedImplementationSketch: 'Implementation sketch',
    keyAssumptions: ['Assumption A'],
    potentialFailureModes: ['Failure A'],
    mechanismCitationIds: [],
    problemCitationIds: [],
    createdAt: '2026-11-19T12:00:00.000Z',
    ...overrides,
  };
}

function makeReview(
  overrides: Partial<CriticReview> & Pick<CriticReview, 'candidateId' | 'status' | 'weightedTotalScore'>,
): CriticReview {
  return {
    experimentId: 'exp-1',
    criticModelUsed: 'gpt-4o',
    scores: {
      mechanismDepth: 2,
      scalabilityAndConstraints: 2,
      technicalValue: 1,
      novelty: 1,
      evidenceQuality: 'PASS',
    },
    criticalCounterarguments: ['Mandatory counterargument'],
    openHurdles: ['Open hurdle'],
    verdictSummary: 'Summary',
    createdAt: '2026-11-19T12:05:00.000Z',
    ...overrides,
  };
}

describe('matrixHelpers', () => {
  it('defines German labels for all VerdictStatus values', () => {
    expect(VERDICT_META.PROMISING.label).toBe('VIELVERSPRECHEND');
    expect(VERDICT_META.NEEDS_CHECK.label).toBe('PRÜFENSWERT');
    expect(VERDICT_META.KNOWN_STANDARD.label).toBe('BEKANNT');
    expect(VERDICT_META.REJECTED_METAPHOR.label).toBe('VERWORFEN (Metapher)');
    expect(VERDICT_META.REJECTED_SCALING.label).toBe('VERWORFEN (Skalierung)');
    expect(VERDICT_META.REJECTED_EVIDENCE.label).toBe('VERWORFEN (Unbelegt)');
    expect(VERDICT_META.RETRACTED.label).toBe('ZURÜCKGEZOGEN');
  });

  it('resolveMechanismsAndProblems prefers newest caches for experiment docs and falls back to other caches', () => {
    const bioCitOld = makeCitation('c-bio-old', 'doc-bio-1');
    const bioCitNew = makeCitation('c-bio-new', 'doc-bio-1');
    const techCit = makeCitation('c-tech-1', 'doc-tech-1');
    const importedBioCit = makeCitation('c-bio-imp', 'doc-imported-bio');

    const caches: ExtractionCacheRecord[] = [
      {
        cacheKey: 'cache-old',
        documentId: 'doc-bio-1',
        domain: 'biology',
        contentHash: 'h1',
        extractionConfigHash: 'cfg1',
        promptHash: 'p1',
        outputLanguage: 'de',
        mechanisms: [makeMechanism('mech-1', 'doc-bio-1', [bioCitOld], 'Old Title')],
        createdAt: '2026-11-18T10:00:00.000Z',
      },
      {
        cacheKey: 'cache-new',
        documentId: 'doc-bio-1',
        domain: 'biology',
        contentHash: 'h1',
        extractionConfigHash: 'cfg2',
        promptHash: 'p1',
        outputLanguage: 'de',
        mechanisms: [makeMechanism('mech-1', 'doc-bio-1', [bioCitNew], 'Newest Title')],
        createdAt: '2026-11-19T10:00:00.000Z',
      },
      {
        cacheKey: 'cache-other-doc',
        documentId: 'doc-imported-bio',
        domain: 'biology',
        contentHash: 'h2',
        extractionConfigHash: 'cfg1',
        promptHash: 'p1',
        outputLanguage: 'de',
        mechanisms: [
          makeMechanism('mech-1', 'doc-imported-bio', [importedBioCit], 'Should Not Override'),
          makeMechanism('mech-imported', 'doc-imported-bio', [importedBioCit], 'Imported Fallback'),
        ],
        createdAt: '2026-11-20T10:00:00.000Z',
      },
      {
        cacheKey: 'cache-tech',
        documentId: 'doc-tech-1',
        domain: 'technology',
        contentHash: 'h3',
        extractionConfigHash: 'cfg1',
        promptHash: 'p1',
        outputLanguage: 'de',
        problems: [makeProblem('prob-1', 'doc-tech-1', [techCit])],
        createdAt: '2026-11-19T11:00:00.000Z',
      },
    ];

    const resolved = resolveMechanismsAndProblems(
      caches,
      ['doc-bio-1'],
      ['doc-tech-1'],
    );

    expect(resolved.mechanisms).toHaveLength(2);
    expect(resolved.mechanisms.find((m) => m.id === 'mech-1')?.title).toBe('Newest Title');
    expect(resolved.mechanisms.find((m) => m.id === 'mech-imported')?.title).toBe(
      'Imported Fallback',
    );
    expect(resolved.problems).toHaveLength(1);
    expect(resolved.problems[0].id).toBe('prob-1');
  });

  it('buildMatrixRows ranks candidates by score desc and resolves citations and document IDs', () => {
    const bioCit1 = makeCitation('cb-1', 'doc-bio-1');
    const bioCit2 = makeCitation('cb-2', 'doc-bio-2');
    const techCit1 = makeCitation('ct-1', 'doc-tech-1');

    const mech1 = makeMechanism('mech-1', 'doc-bio-1', [bioCit1, bioCit2]);
    const prob1 = makeProblem('prob-1', 'doc-tech-1', [techCit1]);

    const candA = makeCandidate({
      id: 'cand-a',
      bridgeTitle: 'Alpha Bridge',
      mechanismCitationIds: ['cb-2'],
      problemCitationIds: ['ct-1'],
    });
    const candB = makeCandidate({
      id: 'cand-b',
      bridgeTitle: 'Beta Bridge',
      mechanismCitationIds: [], // triggers fallback to mechanism.citations
      problemCitationIds: ['missing-id'], // triggers fallback to problem.citations
    });

    const reviews = [
      makeReview({ candidateId: 'cand-a', status: 'NEEDS_CHECK', weightedTotalScore: 6.5 }),
      makeReview({ candidateId: 'cand-b', status: 'PROMISING', weightedTotalScore: 8.5 }),
    ];

    const rows = buildMatrixRows({
      candidates: [candA, candB],
      reviews,
      mechanisms: [mech1],
      problems: [prob1],
    });

    expect(rows.map((r) => [r.rank, r.candidate.id])).toEqual([
      [1, 'cand-b'],
      [2, 'cand-a'],
    ]);
    expect(rows[0].mechanismCitations.map((c) => c.id)).toEqual(['cb-1', 'cb-2']);
    expect(rows[0].problemCitations.map((c) => c.id)).toEqual(['ct-1']);
    expect(rows[1].mechanismCitations.map((c) => c.id)).toEqual(['cb-2']);
    expect(rows[1].sourceDocumentIds).toContain('doc-bio-1');
    expect(rows[1].sourceDocumentIds).toContain('doc-bio-2');
    expect(rows[1].sourceDocumentIds).toContain('doc-tech-1');
    expect(rows[0].isRejectedOrRetracted).toBe(false);
  });

  it('partitionMatrixRows separates primary rows from rejected and retracted rows', () => {
    const mech = makeMechanism('mech-1', 'doc-bio-1', [makeCitation('cb-1', 'doc-bio-1')]);
    const prob = makeProblem('prob-1', 'doc-tech-1', [makeCitation('ct-1', 'doc-tech-1')]);

    const candidates = [
      makeCandidate({ id: 'c1', bridgeTitle: 'Promising' }),
      makeCandidate({ id: 'c2', bridgeTitle: 'Check' }),
      makeCandidate({ id: 'c3', bridgeTitle: 'Known' }),
      makeCandidate({ id: 'c4', bridgeTitle: 'Metaphor' }),
      makeCandidate({ id: 'c5', bridgeTitle: 'Scaling' }),
      makeCandidate({ id: 'c6', bridgeTitle: 'Evidence' }),
      makeCandidate({ id: 'c7', bridgeTitle: 'Retracted' }),
    ];

    const reviews = [
      makeReview({ candidateId: 'c1', status: 'PROMISING', weightedTotalScore: 9 }),
      makeReview({ candidateId: 'c2', status: 'NEEDS_CHECK', weightedTotalScore: 7 }),
      makeReview({ candidateId: 'c3', status: 'KNOWN_STANDARD', weightedTotalScore: 4 }),
      makeReview({ candidateId: 'c4', status: 'REJECTED_METAPHOR', weightedTotalScore: 1 }),
      makeReview({ candidateId: 'c5', status: 'REJECTED_SCALING', weightedTotalScore: 2 }),
      makeReview({ candidateId: 'c6', status: 'REJECTED_EVIDENCE', weightedTotalScore: 0 }),
      makeReview({ candidateId: 'c7', status: 'RETRACTED', weightedTotalScore: 0 }),
    ];

    const rows = buildMatrixRows({
      candidates,
      reviews,
      mechanisms: [mech],
      problems: [prob],
    });

    const { primaryRows, rejectedRows } = partitionMatrixRows(rows);
    expect(primaryRows.map((r) => r.candidate.id)).toEqual(['c1', 'c2', 'c3']);
    expect(rejectedRows.map((r) => r.candidate.id)).toEqual(['c5', 'c4', 'c6', 'c7']);
  });

  it('computeMatrixSummary calculates status counts and rejection rate', () => {
    const emptySummary = computeMatrixSummary([]);
    expect(emptySummary).toEqual({
      total: 0,
      promising: 0,
      needsCheck: 0,
      knownStandard: 0,
      rejected: 0,
      retracted: 0,
      rejectionRatePercent: 0,
    });

    const rows = buildMatrixRows({
      candidates: [
        makeCandidate({ id: 'c1', bridgeTitle: '1' }),
        makeCandidate({ id: 'c2', bridgeTitle: '2' }),
        makeCandidate({ id: 'c3', bridgeTitle: '3' }),
        makeCandidate({ id: 'c4', bridgeTitle: '4' }),
        makeCandidate({ id: 'c5', bridgeTitle: '5' }),
      ],
      reviews: [
        makeReview({ candidateId: 'c1', status: 'PROMISING', weightedTotalScore: 9 }),
        makeReview({ candidateId: 'c2', status: 'REJECTED_METAPHOR', weightedTotalScore: 1 }),
        makeReview({ candidateId: 'c3', status: 'REJECTED_SCALING', weightedTotalScore: 2 }),
        makeReview({ candidateId: 'c4', status: 'REJECTED_EVIDENCE', weightedTotalScore: 0 }),
        makeReview({ candidateId: 'c5', status: 'RETRACTED', weightedTotalScore: 0 }),
      ],
      mechanisms: [],
      problems: [],
    });

    expect(computeMatrixSummary(rows)).toEqual({
      total: 5,
      promising: 1,
      needsCheck: 0,
      knownStandard: 0,
      rejected: 3,
      retracted: 1,
      rejectionRatePercent: 80,
    });
  });

  it('filterAndSortMatrixRows supports all filter and sort modes', () => {
    const bioExact = makeCitation('cb-exact', 'doc-bio-1', 'VERIFIED_EXACT', 'Ant pheromone trail');
    const bioCorrected = makeCitation('cb-corr', 'doc-bio-2', 'CORRECTED_VERIFIED', 'Lotus leaf wax');
    const bioHalluc = makeCitation('cb-hall', 'doc-bio-1', 'RETRACTED_HALLUCINATION', 'Fake quote');
    const techExact = makeCitation('ct-exact', 'doc-tech-1', 'VERIFIED_EXACT', 'Sidecar proxy');

    const mech1 = makeMechanism('mech-1', 'doc-bio-1', [bioExact]);
    const mech2 = makeMechanism('mech-2', 'doc-bio-2', [bioCorrected]);
    const mech3 = makeMechanism('mech-3', 'doc-bio-1', [bioHalluc]);
    const prob1 = makeProblem('prob-1', 'doc-tech-1', [techExact]);

    const rows = buildMatrixRows({
      candidates: [
        makeCandidate({
          id: 'c-prom',
          bridgeTitle: 'Zeta Evaporative Mesh',
          mechanismId: 'mech-1',
          mechanismCitationIds: ['cb-exact'],
          problemCitationIds: ['ct-exact'],
        }),
        makeCandidate({
          id: 'c-check',
          bridgeTitle: 'Alpha Lotus Coating',
          mechanismId: 'mech-2',
          mechanismCitationIds: ['cb-corr'],
          problemCitationIds: ['ct-exact'],
        }),
        makeCandidate({
          id: 'c-retract',
          bridgeTitle: 'Beta Hallucinated Idea',
          mechanismId: 'mech-3',
          mechanismCitationIds: ['cb-hall'],
          problemCitationIds: ['ct-exact'],
        }),
      ],
      reviews: [
        makeReview({
          candidateId: 'c-prom',
          status: 'PROMISING',
          weightedTotalScore: 8.5,
          scalingWarning: 'Needs oscillation guard',
          scores: {
            mechanismDepth: 3,
            scalabilityAndConstraints: 2,
            technicalValue: 2,
            novelty: 1,
            evidenceQuality: 'PASS',
          },
        }),
        makeReview({
          candidateId: 'c-check',
          status: 'NEEDS_CHECK',
          weightedTotalScore: 6.5,
          scores: {
            mechanismDepth: 2,
            scalabilityAndConstraints: 3,
            technicalValue: 1,
            novelty: 2,
            evidenceQuality: 'PASS',
          },
        }),
        makeReview({
          candidateId: 'c-retract',
          status: 'RETRACTED',
          weightedTotalScore: 0,
          scores: {
            mechanismDepth: 0,
            scalabilityAndConstraints: 0,
            technicalValue: 0,
            novelty: 0,
            evidenceQuality: 'KO',
          },
        }),
      ],
      mechanisms: [mech1, mech2, mech3],
      problems: [prob1],
    });

    const runFilter = (patch: Partial<MatrixFilterState>) =>
      filterAndSortMatrixRows(rows, { ...DEFAULT_MATRIX_FILTER_STATE, ...patch }).map(
        (r) => r.candidate.id,
      );

    // Search query
    expect(runFilter({ searchQuery: 'lotus' })).toEqual(['c-check']);
    expect(runFilter({ searchQuery: 'pheromone' })).toEqual(['c-prom']);

    // Status filters
    expect(runFilter({ statusFilter: 'PROMISING' })).toEqual(['c-prom']);
    expect(runFilter({ statusFilter: 'NEEDS_CHECK' })).toEqual(['c-check']);
    expect(runFilter({ statusFilter: 'RETRACTED' })).toEqual(['c-retract']);

    // Document filter
    expect(runFilter({ documentIdFilter: 'doc-bio-2' })).toEqual(['c-check']);
    expect(runFilter({ documentIdFilter: 'doc-bio-1' })).toEqual(['c-prom', 'c-retract']);

    // Scaling warnings only
    expect(runFilter({ onlyScalingWarnings: true })).toEqual(['c-prom']);

    // Verification filters
    expect(runFilter({ verificationFilter: 'VERIFIED_ONLY' })).toEqual([
      'c-prom',
      'c-check',
    ]);
    expect(runFilter({ verificationFilter: 'CORRECTED_ONLY' })).toEqual(['c-check']);
    expect(runFilter({ verificationFilter: 'ISSUES_ONLY' })).toEqual(['c-retract']);

    // Sort modes
    expect(runFilter({ sortBy: 'score_desc' })).toEqual(['c-prom', 'c-check', 'c-retract']);
    expect(runFilter({ sortBy: 'score_asc' })).toEqual(['c-retract', 'c-check', 'c-prom']);
    expect(runFilter({ sortBy: 'mechanism_desc' })).toEqual([
      'c-prom',
      'c-check',
      'c-retract',
    ]);
    expect(runFilter({ sortBy: 'scalability_desc' })).toEqual([
      'c-check',
      'c-prom',
      'c-retract',
    ]);
    expect(runFilter({ sortBy: 'novelty_desc' })).toEqual([
      'c-check',
      'c-prom',
      'c-retract',
    ]);
    expect(runFilter({ sortBy: 'title_asc' })).toEqual([
      'c-check', // Alpha
      'c-retract', // Beta
      'c-prom', // Zeta
    ]);
  });
});
