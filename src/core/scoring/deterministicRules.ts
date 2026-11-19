import type {
  Citation,
  CriticReview,
  ScoreBreakdown,
  ScoringWeights,
  VerificationStatus,
  VerdictStatus,
} from '../schemas';

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  mechanismDepth: 1,
  scalabilityAndConstraints: 1,
  technicalValue: 1,
  novelty: 1,
};

const VERIFIED_STATUSES: ReadonlySet<VerificationStatus> = new Set([
  'VERIFIED_EXACT',
  'VERIFIED_NORMALIZED',
  'VERIFIED_FUZZY',
  'CORRECTED_VERIFIED',
]);

/**
 * Returns true if the citation passed deterministic verification or self-correction.
 */
export function isCitationVerified(citation: Citation): boolean {
  return VERIFIED_STATUSES.has(citation.verification.status);
}

/**
 * Checks whether both the biological mechanism and the technical problem
 * have at least one verified citation.
 */
export function hasVerifiedEvidence(
  mechanismCitations: Citation[],
  problemCitations: Citation[],
): { passed: boolean; allRetracted: boolean; reason?: string } {
  const mechVerified = mechanismCitations.some(isCitationVerified);
  const probVerified = problemCitations.some(isCitationVerified);

  if (mechVerified && probVerified) {
    return { passed: true, allRetracted: false };
  }

  const mechAllRetracted =
    !mechVerified &&
    mechanismCitations.length > 0 &&
    mechanismCitations.every((c) => c.verification.status === 'RETRACTED_HALLUCINATION');
  const probAllRetracted =
    !probVerified &&
    problemCitations.length > 0 &&
    problemCitations.every((c) => c.verification.status === 'RETRACTED_HALLUCINATION');

  const allRetracted =
    (!mechVerified && !probVerified && mechAllRetracted && probAllRetracted) ||
    (!mechVerified && probVerified && mechAllRetracted) ||
    (mechVerified && !probVerified && probAllRetracted);

  const missingSides: string[] = [];
  if (!mechVerified) missingSides.push('biology mechanism');
  if (!probVerified) missingSides.push('technology problem');

  return {
    passed: false,
    allRetracted,
    reason: `Missing verified citation(s) for: ${missingSides.join(' and ')}.`,
  };
}

/**
 * Computes the weighted total score normalized to 0..10 with 1 decimal place.
 * With default weights (1/1/1/1), equals mechanismDepth + scalabilityAndConstraints + technicalValue + novelty.
 */
export function computeWeightedScore(
  scores: ScoreBreakdown,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  const maxWeighted =
    3 * weights.mechanismDepth +
    3 * weights.scalabilityAndConstraints +
    2 * weights.technicalValue +
    2 * weights.novelty;

  if (maxWeighted <= 0) {
    return 0;
  }

  const weightedSum =
    scores.mechanismDepth * weights.mechanismDepth +
    scores.scalabilityAndConstraints * weights.scalabilityAndConstraints +
    scores.technicalValue * weights.technicalValue +
    scores.novelty * weights.novelty;

  const normalized = (weightedSum / maxWeighted) * 10;
  return Math.round(normalized * 10) / 10;
}

export interface EnforceReviewRulesInput {
  rawReview: Omit<CriticReview, 'weightedTotalScore' | 'status'> & { status?: VerdictStatus };
  mechanismCitations: Citation[];
  problemCitations: Citation[];
  weights?: ScoringWeights;
}

/**
 * Enforces deterministic anti-sycophancy, evidence K.O., and score capping rules
 * on a critic review.
 */
export function enforceDeterministicReviewRules(input: EnforceReviewRulesInput): CriticReview {
  const { rawReview, mechanismCitations, problemCitations, weights = DEFAULT_SCORING_WEIGHTS } =
    input;

  const criticalCounterarguments = rawReview.criticalCounterarguments
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (criticalCounterarguments.length === 0) {
    criticalCounterarguments.push(
      'Deterministic guard: No explicit counterargument provided by critic; requires manual technical risk review.',
    );
  }

  const scores: ScoreBreakdown = { ...rawReview.scores };
  const evidence = hasVerifiedEvidence(mechanismCitations, problemCitations);

  let status: VerdictStatus;
  let weightedTotalScore: number;
  let scalingWarning = rawReview.scalingWarning?.trim() || undefined;

  if (!evidence.passed) {
    scores.evidenceQuality = 'KO';
    status = evidence.allRetracted ? 'RETRACTED' : 'REJECTED_EVIDENCE';
    weightedTotalScore = 0;
  } else if (scores.evidenceQuality === 'KO') {
    status = 'REJECTED_EVIDENCE';
    weightedTotalScore = 0;
  } else {
    const baseScore = computeWeightedScore(scores, weights);

    if (scores.mechanismDepth === 0) {
      status = 'REJECTED_METAPHOR';
      weightedTotalScore = Math.min(baseScore, 2);
    } else if (scores.scalabilityAndConstraints === 0) {
      status = 'REJECTED_SCALING';
      weightedTotalScore = Math.min(baseScore, 3);
      if (!scalingWarning) {
        scalingWarning =
          'Deterministic scaling K.O.: scalabilityAndConstraints scored 0 due to incompatible boundary conditions.';
      }
    } else if (
      scores.novelty === 0 &&
      scores.mechanismDepth >= 2 &&
      scores.scalabilityAndConstraints >= 2
    ) {
      status = 'KNOWN_STANDARD';
      weightedTotalScore = baseScore;
    } else {
      weightedTotalScore = baseScore;
      status = weightedTotalScore >= 7 ? 'PROMISING' : 'NEEDS_CHECK';
    }
  }

  return {
    ...rawReview,
    scores,
    weightedTotalScore,
    status,
    scalingWarning,
    criticalCounterarguments,
  };
}
