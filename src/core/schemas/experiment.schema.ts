import { z } from 'zod';
import { CrossingStrategyTypeSchema, DistanceBandSchema } from './crossing.schema';
import { PromptProfileSchema } from './prompt.schema';
import { ScoringWeightsSchema } from './review.schema';

export const ProviderIdSchema = z.enum([
  'gemini',
  'openai',
  'anthropic',
  'deepseek',
  'openrouter',
  'custom',
]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const ModelRoleSchema = z.enum([
  'extraction',
  'vision',
  'embedding',
  'crossing',
  'critic',
]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'extreme']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const ModelAssignmentSchema = z.object({
  provider: ProviderIdSchema,
  modelId: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
});
export type ModelAssignment = z.infer<typeof ModelAssignmentSchema>;

export const ModelAssignmentsSchema = z.object({
  extraction: ModelAssignmentSchema,
  vision: ModelAssignmentSchema,
  embedding: ModelAssignmentSchema,
  crossing: ModelAssignmentSchema,
  critic: ModelAssignmentSchema,
});
export type ModelAssignments = z.infer<typeof ModelAssignmentsSchema>;

export const PdfMathVisionModeSchema = z.enum(['auto', 'always', 'off']);
export type PdfMathVisionMode = z.infer<typeof PdfMathVisionModeSchema>;

export const ExperimentStatusSchema = z.enum([
  'DRAFT',
  'ESTIMATED',
  'RUNNING',
  'PAUSED',
  'BUDGET_STOPPED',
  'COMPLETED',
  'FAILED',
]);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

export const PipelinePhaseSchema = z.enum([
  'idle',
  'phase1_vision',
  'phase2_extract',
  'phase3_cross',
  'phase4_critic',
  'completed',
]);
export type PipelinePhase = z.infer<typeof PipelinePhaseSchema>;

export const CostRangeSchema = z.object({
  minUsd: z.number().min(0),
  expectedUsd: z.number().min(0),
  maxUsd: z.number().min(0),
  estimatedTokens: z.number().int().min(0),
});
export type CostRange = z.infer<typeof CostRangeSchema>;

export const CostEstimateSchema = z.object({
  phase1Vision: CostRangeSchema,
  phase2Extract: CostRangeSchema,
  phase3Cross: CostRangeSchema,
  phase4Critic: CostRangeSchema,
  total: CostRangeSchema,
  cachedDocumentIds: z.array(z.string()),
  visionPageCount: z.number().int().min(0),
  estimatedDurationSec: z.object({
    min: z.number().min(0),
    expected: z.number().min(0),
    max: z.number().min(0),
  }),
  usdToEurRate: z.number().positive(),
  computedAt: z.string().min(1),
});
export type CostEstimate = z.infer<typeof CostEstimateSchema>;

export const CostLedgerEntrySchema = z.object({
  timestamp: z.string().min(1),
  phase: PipelinePhaseSchema,
  role: ModelRoleSchema,
  provider: ProviderIdSchema,
  modelId: z.string().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  visionImages: z.number().int().min(0).optional(),
  costUsd: z.number().min(0),
});
export type CostLedgerEntry = z.infer<typeof CostLedgerEntrySchema>;

export const CostLedgerSchema = z.object({
  totalInputTokens: z.number().int().min(0),
  totalOutputTokens: z.number().int().min(0),
  totalVisionImages: z.number().int().min(0),
  totalCostUsd: z.number().min(0),
  entries: z.array(CostLedgerEntrySchema),
});
export type CostLedger = z.infer<typeof CostLedgerSchema>;

export const RunConfigSchema = z.object({
  outputLanguage: z.string().min(1),
  crossingStrategy: CrossingStrategyTypeSchema,
  creativityDistance: z.number().min(0).max(1),
  distanceBand: DistanceBandSchema,
  maxCandidates: z.number().int().min(1),
  includeDiagrams: z.boolean(),
  pdfMathVisionMode: PdfMathVisionModeSchema,
  modelAssignments: ModelAssignmentsSchema,
  weights: ScoringWeightsSchema,
  budgetLimitUsd: z.number().positive().optional(),
  promptProfileSnapshot: PromptProfileSchema,
});
export type RunConfig = z.infer<typeof RunConfigSchema>;

export const PipelineCheckpointSchema = z.object({
  currentPhase: PipelinePhaseSchema,
  completedVisionPageKeys: z.array(z.string()),
  completedChunkKeys: z.array(z.string()),
  completedPairKeys: z.array(z.string()),
  completedReviewKeys: z.array(z.string()),
  lastError: z.string().optional(),
});
export type PipelineCheckpoint = z.infer<typeof PipelineCheckpointSchema>;

export const ExperimentRunSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  status: ExperimentStatusSchema,
  biologyDocIds: z.array(z.string()),
  technologyDocIds: z.array(z.string()),
  config: RunConfigSchema,
  checkpoint: PipelineCheckpointSchema,
  costEstimate: CostEstimateSchema.optional(),
  costLedger: CostLedgerSchema,
});
export type ExperimentRun = z.infer<typeof ExperimentRunSchema>;
