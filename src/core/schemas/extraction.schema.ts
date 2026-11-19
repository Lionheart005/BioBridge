import { z } from 'zod';
import { DomainSchema } from './document.schema';

export const VerificationStatusSchema = z.enum([
  'VERIFIED_EXACT',
  'VERIFIED_NORMALIZED',
  'VERIFIED_FUZZY',
  'CORRECTED_VERIFIED',
  'RETRACTED_HALLUCINATION',
  'FAILED_UNVERIFIED',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const CitationVerificationSchema = z.object({
  status: VerificationStatusSchema,
  matchScore: z.number().min(0).max(1),
  matchedPageNumber: z.number().int().min(1),
  attempts: z.number().int().min(1),
  retractionReason: z.string().optional(),
});
export type CitationVerification = z.infer<typeof CitationVerificationSchema>;

export const CitationSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  documentTitle: z.string().min(1),
  pageNumber: z.number().int().min(1),
  sectionPath: z.string(),
  quoteOriginal: z.string().min(1),
  quoteTranslation: z.string().optional(),
  contextBefore: z.string(),
  contextAfter: z.string(),
  verification: CitationVerificationSchema,
});
export type Citation = z.infer<typeof CitationSchema>;

export const BoundaryConditionsSchema = z.object({
  spatialScale: z.string(),
  timeScale: z.string(),
  medium: z.string(),
  energyForm: z.string(),
  operatingConstraints: z.string(),
  faultTolerance: z.string().optional(),
  reliabilityRequirements: z.string().optional(),
});
export type BoundaryConditions = z.infer<typeof BoundaryConditionsSchema>;

export const ExtractedMechanismSchema = z.object({
  id: z.string().min(1),
  sourceDocumentIds: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  biologicalSystem: z.string().min(1),
  structure: z.string().min(1),
  workingPrinciple: z.string().min(1),
  achievedEffect: z.string().min(1),
  boundaryConditions: BoundaryConditionsSchema,
  functionalAbstract: z.string().min(1),
  citations: z.array(CitationSchema).min(1),
});
export type ExtractedMechanism = z.infer<typeof ExtractedMechanismSchema>;

export const ExtractedProblemSchema = z.object({
  id: z.string().min(1),
  sourceDocumentIds: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  technicalDomain: z.string().min(1),
  problemStatement: z.string().min(1),
  coreBottleneck: z.string().min(1),
  targetMetrics: z.string(),
  currentApproachesAndLimits: z.string(),
  boundaryConditions: BoundaryConditionsSchema,
  functionalNeedAbstract: z.string().min(1),
  citations: z.array(CitationSchema).min(1),
});
export type ExtractedProblem = z.infer<typeof ExtractedProblemSchema>;

export const ExtractionCacheRecordSchema = z.object({
  cacheKey: z.string().min(1),
  documentId: z.string().min(1),
  domain: DomainSchema,
  contentHash: z.string().min(1),
  extractionConfigHash: z.string().min(1),
  promptHash: z.string().min(1),
  outputLanguage: z.string().min(1),
  mechanisms: z.array(ExtractedMechanismSchema).optional(),
  problems: z.array(ExtractedProblemSchema).optional(),
  createdAt: z.string().min(1),
});
export type ExtractionCacheRecord = z.infer<typeof ExtractionCacheRecordSchema>;
