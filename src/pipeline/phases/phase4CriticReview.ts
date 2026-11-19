import { z } from 'zod';
import { requestStructuredOutput, type UsageReceipt } from '@/ai';
import type {
  Citation,
  CriticReview,
  CrossingCandidate,
  ExtractedMechanism,
  ExtractedProblem,
} from '@/core/schemas';
import { enforceDeterministicReviewRules } from '@/core/scoring/deterministicRules';
import { CRITIC_PROMPT, compilePrompt } from '@/prompts';
import { getReviewsForExperiment, saveReviews } from '@/storage';
import type { PipelineRuntimeContext } from '../orchestrator';
import { BudgetLimitExceededError } from '../strategies/crossingStrategy.interface';

const RawCriticScoresSchema = z.object({
  mechanismDepth: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  scalabilityAndConstraints: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  technicalValue: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  novelty: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  evidenceQuality: z.enum(['PASS', 'KO']),
});

const RawCriticOutputSchema = z.object({
  scores: RawCriticScoresSchema,
  status: z
    .enum([
      'PROMISING',
      'NEEDS_CHECK',
      'KNOWN_STANDARD',
      'REJECTED_METAPHOR',
      'REJECTED_SCALING',
      'REJECTED_EVIDENCE',
    ])
    .optional(),
  scalingWarning: z.string().optional(),
  knownPriorArt: z.string().optional(),
  criticalCounterarguments: z.array(z.string()),
  openHurdles: z.array(z.string()),
  verdictSummary: z.string().min(1),
});

function resolveCandidateCitations(
  citationIds: string[],
  sourceCitations: Citation[],
): Citation[] {
  if (sourceCitations.length === 0) {
    return [];
  }
  const byId = new Map(sourceCitations.map((c) => [c.id, c]));
  const matched = citationIds
    .map((id) => byId.get(id))
    .filter((c): c is Citation => c !== undefined);
  return matched.length > 0 ? matched : sourceCitations;
}

function formatCitationsForCritic(citations: Citation[]): Array<Record<string, unknown>> {
  return citations.map((c) => ({
    citationId: c.id,
    documentTitle: c.documentTitle,
    pageNumber: c.pageNumber,
    sectionPath: c.sectionPath,
    quoteOriginal: c.quoteOriginal,
    verificationStatus: c.verification.status,
    retractionReason: c.verification.retractionReason,
    contextBefore: c.contextBefore,
    contextAfter: c.contextAfter,
  }));
}

function buildIsolatedCriticUserMessage(params: {
  candidate: CrossingCandidate;
  mechanism?: ExtractedMechanism;
  problem?: ExtractedProblem;
  mechanismCitations: Citation[];
  problemCitations: Citation[];
}): string {
  const { candidate, mechanism, problem, mechanismCitations, problemCitations } =
    params;

  return JSON.stringify(
    {
      hypothesis: {
        candidateId: candidate.id,
        bridgeTitle: candidate.bridgeTitle,
        abstractTransferLogic: candidate.abstractTransferLogic,
        proposedImplementationSketch: candidate.proposedImplementationSketch,
        keyAssumptions: candidate.keyAssumptions,
        potentialFailureModes: candidate.potentialFailureModes,
      },
      biologySource: {
        biologicalSystem: mechanism?.biologicalSystem ?? 'unknown',
        workingPrinciple: mechanism?.workingPrinciple ?? 'unknown',
        boundaryConditions: mechanism?.boundaryConditions ?? {},
        citations: formatCitationsForCritic(mechanismCitations),
      },
      technologySource: {
        technicalDomain: problem?.technicalDomain ?? 'unknown',
        problemStatement: problem?.problemStatement ?? 'unknown',
        coreBottleneck: problem?.coreBottleneck ?? 'unknown',
        boundaryConditions: problem?.boundaryConditions ?? {},
        citations: formatCitationsForCritic(problemCitations),
      },
    },
    null,
    2,
  );
}

/**
 * Phase 4: Isolated Advocatus Diaboli.
 * Sends a fresh, isolated call per CrossingCandidate with zero Phase 3 chat history,
 * using `config.modelAssignments.critic`, and strictly enforces deterministic rules.
 */
export async function runPhase4CriticReview(
  ctx: PipelineRuntimeContext,
  candidates: CrossingCandidate[],
  mechanisms: ExtractedMechanism[],
  problems: ExtractedProblem[],
): Promise<CriticReview[]> {
  const existingReviews = await getReviewsForExperiment(ctx.experiment.id, ctx.db);
  const reviewsByCandidateId = new Map<string, CriticReview>(
    existingReviews.map((r) => [r.candidateId, r]),
  );
  const completedKeys = new Set(ctx.experiment.checkpoint.completedReviewKeys);

  if (candidates.length === 0) {
    return existingReviews;
  }

  const mechMap = new Map(mechanisms.map((m) => [m.id, m]));
  const probMap = new Map(problems.map((p) => [p.id, p]));

  const { config } = ctx.experiment;
  const criticModel = config.modelAssignments.critic;
  const criticSystemPrompt = compilePrompt(
    config.promptProfileSnapshot.slots.critic ?? CRITIC_PROMPT,
    {
      OUTPUT_LANGUAGE: config.outputLanguage,
    },
  );

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (
      completedKeys.has(candidate.id) &&
      reviewsByCandidateId.has(candidate.id)
    ) {
      continue;
    }

    await ctx.checkBudgetAndPause();

    const mechanism = mechMap.get(candidate.mechanismId);
    const problem = probMap.get(candidate.problemId);
    const mechanismCitations = resolveCandidateCitations(
      candidate.mechanismCitationIds,
      mechanism?.citations ?? [],
    );
    const problemCitations = resolveCandidateCitations(
      candidate.problemCitationIds,
      problem?.citations ?? [],
    );

    const userMessage = buildIsolatedCriticUserMessage({
      candidate,
      mechanism,
      problem,
      mechanismCitations,
      problemCitations,
    });

    const usageTasks: Promise<void>[] = [];
    let deferredBudgetError: BudgetLimitExceededError | null = null;
    const onUsage = (usage: UsageReceipt): void => {
      const task = ctx
        .recordUsage(
          'phase4_critic',
          'critic',
          criticModel.provider,
          criticModel.modelId,
          usage,
        )
        .catch((err: unknown) => {
          if (err instanceof BudgetLimitExceededError) {
            deferredBudgetError ??= err;
            return;
          }
          throw err;
        });
      usageTasks.push(task);
    };

    const structured = await ctx.queue.enqueue(
      (qSignal) =>
        requestStructuredOutput({
          transport: ctx.transport,
          request: {
            provider: criticModel.provider,
            modelId: criticModel.modelId,
            role: 'critic',
            temperature: criticModel.temperature ?? 0.2,
            reasoningEffort: criticModel.reasoningEffort,
            // Strictly isolated fresh message array — no Phase 3 conversation history
            messages: [
              { role: 'system', content: criticSystemPrompt },
              { role: 'user', content: userMessage },
            ],
            metadata: {
              experimentId: ctx.experiment.id,
              phase: 'phase4_critic',
            },
          },
          schema: RawCriticOutputSchema,
          schemaName: 'CriticReviewOutput',
          signal: qSignal,
          onUsage,
        }),
      ctx.signal,
    );

    await Promise.all(usageTasks);

    const raw = structured.data;
    const review = enforceDeterministicReviewRules({
      rawReview: {
        candidateId: candidate.id,
        experimentId: ctx.experiment.id,
        criticModelUsed: `${criticModel.provider}:${criticModel.modelId}`,
        scores: raw.scores,
        status: raw.status,
        scalingWarning: raw.scalingWarning,
        knownPriorArt: raw.knownPriorArt,
        criticalCounterarguments: raw.criticalCounterarguments,
        openHurdles: raw.openHurdles,
        verdictSummary: raw.verdictSummary,
        createdAt: new Date().toISOString(),
      },
      mechanismCitations,
      problemCitations,
      weights: config.weights,
    });

    await saveReviews([review], ctx.db);
    reviewsByCandidateId.set(candidate.id, review);

    if (!completedKeys.has(candidate.id)) {
      completedKeys.add(candidate.id);
      ctx.experiment.checkpoint.completedReviewKeys.push(candidate.id);
    }
    await ctx.saveCheckpoint();

    ctx.emit({
      type: 'progress',
      experimentId: ctx.experiment.id,
      phase: 'phase4_critic',
      completed: reviewsByCandidateId.size,
      total: candidates.length,
      detail: `${candidate.bridgeTitle} -> ${review.status} (${review.weightedTotalScore}/10)`,
      timestamp: new Date().toISOString(),
    });

    if (deferredBudgetError) {
      throw deferredBudgetError;
    }
  }

  return Array.from(reviewsByCandidateId.values());
}
