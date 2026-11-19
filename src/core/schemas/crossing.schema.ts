import { z } from 'zod';
import { DomainSchema } from './document.schema';

export const CrossingStrategyTypeSchema = z.enum(['embedding-hybrid', 'cluster-batch']);
export type CrossingStrategyType = z.infer<typeof CrossingStrategyTypeSchema>;

export const DistanceBandSchema = z.enum(['strict', 'balanced', 'exploratory']);
export type DistanceBand = z.infer<typeof DistanceBandSchema>;

export const ClusterSummarySchema = z.object({
  id: z.string().min(1),
  domain: DomainSchema,
  label: z.string().min(1),
  description: z.string(),
  memberIds: z.array(z.string().min(1)),
});
export type ClusterSummary = z.infer<typeof ClusterSummarySchema>;

export const CrossingCandidateSchema = z.object({
  id: z.string().min(1),
  experimentId: z.string().min(1),
  mechanismId: z.string().min(1),
  problemId: z.string().min(1),
  strategyUsed: CrossingStrategyTypeSchema,
  similarityScore: z.number().min(-1).max(1).optional(),
  distanceBand: DistanceBandSchema.optional(),
  bridgeTitle: z.string().min(1),
  abstractTransferLogic: z.string().min(1),
  proposedImplementationSketch: z.string().min(1),
  keyAssumptions: z.array(z.string()),
  potentialFailureModes: z.array(z.string()),
  mechanismCitationIds: z.array(z.string().min(1)),
  problemCitationIds: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
});
export type CrossingCandidate = z.infer<typeof CrossingCandidateSchema>;
