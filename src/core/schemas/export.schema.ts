import { z } from 'zod';
import { CrossingCandidateSchema } from './crossing.schema';
import { ParsedPageSchema, SourceDocumentSchema } from './document.schema';
import { ExperimentRunSchema } from './experiment.schema';
import { ExtractedMechanismSchema, ExtractedProblemSchema } from './extraction.schema';
import { CriticReviewSchema } from './review.schema';

export const BioBridgeProjectBundleSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  exportedAt: z.string().min(1),
  experiment: ExperimentRunSchema,
  documents: z.array(SourceDocumentSchema),
  parsedPages: z.array(ParsedPageSchema),
  mechanisms: z.array(ExtractedMechanismSchema),
  problems: z.array(ExtractedProblemSchema),
  candidates: z.array(CrossingCandidateSchema),
  reviews: z.array(CriticReviewSchema),
});
export type BioBridgeProjectBundle = z.infer<typeof BioBridgeProjectBundleSchema>;
