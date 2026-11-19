import { describe, expect, it } from 'vitest';
import type { Citation, ScoreBreakdown, VerificationStatus } from '@/core/schemas';
import {
  computeWeightedScore,
  DEFAULT_SCORING_WEIGHTS,
  enforceDeterministicReviewRules,
  hasVerifiedEvidence,
  isCitationVerified,
} from '@/core/scoring/deterministicRules';

const makeCitation = (status: VerificationStatus): Citation => ({
  id: `cit-${status}`,
  documentId: 'doc-1',
  documentTitle: 'Paper',
  pageNumber: 1,
  sectionPath: '1',
  quoteOriginal: 'Verified quote text from source document.',
  contextBefore: 'Before',
  contextAfter: 'After',
  verification: {
    status,
    matchScore: status.startsWith('VERIFIED') ? 1 : 0,
    matchedPageNumber: 1,
    attempts: 1,
  },
});

const baseRawReview = (scores: ScoreBreakdown, counterargs = ['Valid counterargument']) => ({
  candidateId: 'cand-1',
  experimentId: 'exp-1',
  criticModelUsed: 'critic-model',
  scores,
  criticalCounterarguments: counterargs,
  openHurdles: ['Hurdle 1'],
  verdictSummary: 'Summary',
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('deterministicRules', () => {
  it('recognizes verified vs unverified citation statuses', () => {
    expect(isCitationVerified(makeCitation('VERIFIED_EXACT'))).toBe(true);
    expect(isCitationVerified(makeCitation('VERIFIED_NORMALIZED'))).toBe(true);
    expect(isCitationVerified(makeCitation('VERIFIED_FUZZY'))).toBe(true);
    expect(isCitationVerified(makeCitation('CORRECTED_VERIFIED'))).toBe(true);
    expect(isCitationVerified(makeCitation('RETRACTED_HALLUCINATION'))).toBe(false);
    expect(isCitationVerified(makeCitation('FAILED_UNVERIFIED'))).toBe(false);
  });

  it('computes weighted score accurately with default and custom weights', () => {
    const scores: ScoreBreakdown = {
      mechanismDepth: 3,
      scalabilityAndConstraints: 2,
      technicalValue: 2,
      novelty: 1,
      evidenceQuality: 'PASS',
    };
    expect(computeWeightedScore(scores, DEFAULT_SCORING_WEIGHTS)).toBe(8);

    const weighted = computeWeightedScore(scores, {
      mechanismDepth: 2,
      scalabilityAndConstraints: 1,
      technicalValue: 1,
      novelty: 1,
    });
    // (3*2 + 2*1 + 2*1 + 1*1) / (3*2 + 3*1 + 2*1 + 2*1) * 10 = 11 / 13 * 10 = 8.46 -> 8.5
    expect(weighted).toBe(8.5);
  });

  it('forces REJECTED_EVIDENCE and score 0 when verified citation is missing', () => {
    const result = enforceDeterministicReviewRules({
      rawReview: baseRawReview({
        mechanismDepth: 3,
        scalabilityAndConstraints: 3,
        technicalValue: 2,
        novelty: 2,
        evidenceQuality: 'PASS',
      }),
      mechanismCitations: [makeCitation('VERIFIED_EXACT')],
      problemCitations: [makeCitation('FAILED_UNVERIFIED')],
    });

    expect(result.scores.evidenceQuality).toBe('KO');
    expect(result.status).toBe('REJECTED_EVIDENCE');
    expect(result.weightedTotalScore).toBe(0);
  });

  it('forces RETRACTED when missing side only has RETRACTED_HALLUCINATION citations', () => {
    const evidence = hasVerifiedEvidence(
      [makeCitation('RETRACTED_HALLUCINATION')],
      [makeCitation('VERIFIED_NORMALIZED')],
    );
    expect(evidence.passed).toBe(false);
    expect(evidence.allRetracted).toBe(true);

    const result = enforceDeterministicReviewRules({
      rawReview: baseRawReview({
        mechanismDepth: 3,
        scalabilityAndConstraints: 3,
        technicalValue: 2,
        novelty: 2,
        evidenceQuality: 'PASS',
      }),
      mechanismCitations: [makeCitation('RETRACTED_HALLUCINATION')],
      problemCitations: [makeCitation('VERIFIED_NORMALIZED')],
    });

    expect(result.status).toBe('RETRACTED');
    expect(result.weightedTotalScore).toBe(0);
  });

  it('enforces REJECTED_EVIDENCE when critic sets evidenceQuality to KO', () => {
    const result = enforceDeterministicReviewRules({
      rawReview: baseRawReview({
        mechanismDepth: 3,
        scalabilityAndConstraints: 3,
        technicalValue: 2,
        novelty: 2,
        evidenceQuality: 'KO',
      }),
      mechanismCitations: [makeCitation('VERIFIED_EXACT')],
      problemCitations: [makeCitation('VERIFIED_EXACT')],
    });

    expect(result.status).toBe('REJECTED_EVIDENCE');
    expect(result.weightedTotalScore).toBe(0);
  });

  it('caps score at 2 and sets REJECTED_METAPHOR when mechanismDepth === 0', () => {
    const result = enforceDeterministicReviewRules({
      rawReview: baseRawReview({
        mechanismDepth: 0,
        scalabilityAndConstraints: 3,
        technicalValue: 2,
        novelty: 2,
        evidenceQuality: 'PASS',
      }),
      mechanismCitations: [makeCitation('VERIFIED_EXACT')],
      problemCitations: [makeCitation('VERIFIED_EXACT')],
    });

    expect(result.status).toBe('REJECTED_METAPHOR');
    expect(result.weightedTotalScore).toBe(2);
  });

  it('caps score at 3, sets REJECTED_SCALING, and guarantees scalingWarning when scalabilityAndConstraints === 0', () => {
    const result = enforceDeterministicReviewRules({
      rawReview: baseRawReview({
        mechanismDepth: 3,
        scalabilityAndConstraints: 0,
        technicalValue: 2,
        novelty: 2,
        evidenceQuality: 'PASS',
      }),
      mechanismCitations: [makeCitation('VERIFIED_EXACT')],
      problemCitations: [makeCitation('VERIFIED_EXACT')],
    });

    expect(result.status).toBe('REJECTED_SCALING');
    expect(result.weightedTotalScore).toBe(3);
    expect(result.scalingWarning).toBeTruthy();
  });

  it('sets KNOWN_STANDARD when novelty === 0 and mechanismDepth >= 2 and scalabilityAndConstraints >= 2', () => {
    const result = enforceDeterministicReviewRules({
      rawReview: baseRawReview({
        mechanismDepth: 2,
        scalabilityAndConstraints: 2,
        technicalValue: 2,
        novelty: 0,
        evidenceQuality: 'PASS',
      }),
      mechanismCitations: [makeCitation('VERIFIED_EXACT')],
      problemCitations: [makeCitation('VERIFIED_EXACT')],
    });

    expect(result.status).toBe('KNOWN_STANDARD');
    expect(result.weightedTotalScore).toBe(6);
  });

  it('assigns PROMISING for score >= 7 and NEEDS_CHECK for score < 7, and guarantees counterarguments', () => {
    const promising = enforceDeterministicReviewRules({
      rawReview: baseRawReview(
        {
          mechanismDepth: 3,
          scalabilityAndConstraints: 2,
          technicalValue: 1,
          novelty: 1,
          evidenceQuality: 'PASS',
        },
        ['   '],
      ),
      mechanismCitations: [makeCitation('VERIFIED_EXACT')],
      problemCitations: [makeCitation('VERIFIED_EXACT')],
    });
    expect(promising.status).toBe('PROMISING');
    expect(promising.weightedTotalScore).toBe(7);
    expect(promising.criticalCounterarguments.length).toBeGreaterThanOrEqual(1);
    expect(promising.criticalCounterarguments[0].trim().length).toBeGreaterThan(0);

    const needsCheck = enforceDeterministicReviewRules({
      rawReview: baseRawReview({
        mechanismDepth: 2,
        scalabilityAndConstraints: 2,
        technicalValue: 1,
        novelty: 1,
        evidenceQuality: 'PASS',
      }),
      mechanismCitations: [makeCitation('VERIFIED_EXACT')],
      problemCitations: [makeCitation('VERIFIED_EXACT')],
    });
    expect(needsCheck.status).toBe('NEEDS_CHECK');
    expect(needsCheck.weightedTotalScore).toBe(6);
  });
});
