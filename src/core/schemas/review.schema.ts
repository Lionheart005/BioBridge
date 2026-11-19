import { z } from 'zod';

export const EvidenceQualitySchema = z.enum(['PASS', 'KO']);
export type EvidenceQuality = z.infer<typeof EvidenceQualitySchema>;

export const VerdictStatusSchema = z.enum([
  'PROMISING',
  'NEEDS_CHECK',
  'KNOWN_STANDARD',
  'REJECTED_METAPHOR',
  'REJECTED_SCALING',
  'REJECTED_EVIDENCE',
  'RETRACTED',
]);
export type VerdictStatus = z.infer<typeof VerdictStatusSchema>;

export const ScoreBreakdownSchema = z.object({
  mechanismDepth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  scalabilityAndConstraints: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  technicalValue: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  novelty: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  evidenceQuality: EvidenceQualitySchema,
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const ScoringWeightsSchema = z.object({
  mechanismDepth: z.number().positive().default(1),
  scalabilityAndConstraints: z.number().positive().default(1),
  technicalValue: z.number().positive().default(1),
  novelty: z.number().positive().default(1),
});
export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;

export const CriticReviewSchema = z.object({
  candidateId: z.string().min(1),
  experimentId: z.string().min(1),
  criticModelUsed: z.string().min(1),
  scores: ScoreBreakdownSchema,
  weightedTotalScore: z.number().min(0).max(10),
  status: VerdictStatusSchema,
  scalingWarning: z.string().optional(),
  knownPriorArt: z.string().optional(),
  criticalCounterarguments: z.array(z.string().trim().min(1)).min(1),
  openHurdles: z.array(z.string()),
  verdictSummary: z.string().min(1),
  createdAt: z.string().min(1),
});
export type CriticReview = z.infer<typeof CriticReviewSchema>;
