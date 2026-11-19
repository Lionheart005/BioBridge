import { z } from 'zod';
import {
  type ITransportAdapter,
  type UsageReceipt,
  requestStructuredOutput,
} from '@/ai';
import type {
  CrossingCandidate,
  CrossingStrategyType,
  ExtractedMechanism,
  ExtractedProblem,
  PipelinePhase,
} from '@/core/schemas';
import { CROSSING_PROMPT, compilePrompt } from '@/prompts';
import { saveCandidates } from '@/storage';
import type { PipelineRuntimeContext } from '../orchestrator';

export class BudgetLimitExceededError extends Error {
  readonly totalCostUsd: number;
  readonly budgetLimitUsd: number;

  constructor(totalCostUsd: number, budgetLimitUsd: number) {
    super(
      `Budget limit exceeded: $${totalCostUsd.toFixed(6)} >= $${budgetLimitUsd.toFixed(6)}`,
    );
    this.name = 'BudgetLimitExceededError';
    this.totalCostUsd = totalCostUsd;
    this.budgetLimitUsd = budgetLimitUsd;
  }
}

export class PipelinePausedError extends Error {
  readonly phase: PipelinePhase;

  constructor(phase: PipelinePhase, message = 'Pipeline paused by user') {
    super(message);
    this.name = 'PipelinePausedError';
    this.phase = phase;
  }
}

export interface CrossingContext {
  runtime: PipelineRuntimeContext;
  mechanisms: ExtractedMechanism[];
  problems: ExtractedProblem[];
  existingCandidates: CrossingCandidate[];
}

export interface ICrossingStrategy {
  readonly strategyId: CrossingStrategyType;
  generateCandidates(ctx: CrossingContext): Promise<CrossingCandidate[]>;
}

export interface SelectedCrossingPair {
  mechanism: ExtractedMechanism;
  problem: ExtractedProblem;
  similarityScore?: number;
}

const RawCrossingCandidateSchema = z.object({
  mechanismId: z.string().min(1),
  problemId: z.string().min(1),
  bridgeTitle: z.string().min(1),
  abstractTransferLogic: z.string().min(1),
  proposedImplementationSketch: z.string().min(1),
  keyAssumptions: z.array(z.string()),
  potentialFailureModes: z.array(z.string()),
  mechanismCitationIds: z.array(z.string()),
  problemCitationIds: z.array(z.string()),
});

const RawCrossingOutputSchema = z.object({
  candidates: z.array(RawCrossingCandidateSchema),
});

export function buildPairKey(mechanismId: string, problemId: string): string {
  return `${mechanismId}::${problemId}`;
}

export function createQueuedTransport(
  runtime: PipelineRuntimeContext,
): ITransportAdapter {
  return {
    mode: runtime.transport.mode,
    sendCompletion: (req, sig) =>
      runtime.queue.enqueue(
        (qSig) => runtime.transport.sendCompletion(req, qSig),
        sig ?? runtime.signal,
      ),
    sendEmbedding: (req, sig) =>
      runtime.queue.enqueue(
        (qSig) => runtime.transport.sendEmbedding(req, qSig),
        sig ?? runtime.signal,
      ),
  };
}

function serializePairForCrossingPrompt(pair: SelectedCrossingPair): Record<string, unknown> {
  const { mechanism: m, problem: p, similarityScore } = pair;
  return {
    pairKey: buildPairKey(m.id, p.id),
    ...(similarityScore !== undefined ? { similarityScore } : {}),
    mechanism: {
      mechanismId: m.id,
      title: m.title,
      biologicalSystem: m.biologicalSystem,
      structure: m.structure,
      workingPrinciple: m.workingPrinciple,
      achievedEffect: m.achievedEffect,
      boundaryConditions: m.boundaryConditions,
      functionalAbstract: m.functionalAbstract,
      citations: m.citations.map((c) => ({
        citationId: c.id,
        pageNumber: c.pageNumber,
        quoteOriginal: c.quoteOriginal,
        status: c.verification.status,
      })),
    },
    problem: {
      problemId: p.id,
      title: p.title,
      technicalDomain: p.technicalDomain,
      problemStatement: p.problemStatement,
      coreBottleneck: p.coreBottleneck,
      targetMetrics: p.targetMetrics,
      currentApproachesAndLimits: p.currentApproachesAndLimits,
      boundaryConditions: p.boundaryConditions,
      functionalNeedAbstract: p.functionalNeedAbstract,
      citations: p.citations.map((c) => ({
        citationId: c.id,
        pageNumber: c.pageNumber,
        quoteOriginal: c.quoteOriginal,
        status: c.verification.status,
      })),
    },
  };
}

function resolveValidCitationIds(
  requestedIds: string[],
  availableIds: string[],
): string[] {
  const allowed = new Set(availableIds);
  const filtered = requestedIds.filter((id) => allowed.has(id));
  if (filtered.length > 0) {
    return Array.from(new Set(filtered));
  }
  return availableIds;
}

/**
 * Shared batch crossing executor used by both Phase 3 strategies.
 * Handles checkpoint skipping via `completedPairKeys`, schema validation,
 * ID/citation verification, incremental DB persistence, and budget checks.
 */
export async function executeCrossingBatches(params: {
  ctx: CrossingContext;
  strategyUsed: CrossingStrategyType;
  selectedPairs: SelectedCrossingPair[];
  batchSize?: number;
}): Promise<CrossingCandidate[]> {
  const { ctx, strategyUsed, selectedPairs } = params;
  const { runtime, existingCandidates } = ctx;
  const { config } = runtime.experiment;
  const batchSize = Math.max(1, params.batchSize ?? 4);

  const completedPairs = new Set(runtime.experiment.checkpoint.completedPairKeys);
  const candidatesByPair = new Map<string, CrossingCandidate>();
  for (const cand of existingCandidates) {
    candidatesByPair.set(buildPairKey(cand.mechanismId, cand.problemId), cand);
  }

  const pendingPairs = selectedPairs.filter((pair) => {
    const key = buildPairKey(pair.mechanism.id, pair.problem.id);
    return !completedPairs.has(key) && !candidatesByPair.has(key);
  });

  if (pendingPairs.length === 0) {
    return Array.from(candidatesByPair.values());
  }

  const crossingModel = config.modelAssignments.crossing;
  const crossingPrompt = compilePrompt(
    config.promptProfileSnapshot.slots.crossing ?? CROSSING_PROMPT,
    {
      OUTPUT_LANGUAGE: config.outputLanguage,
      CREATIVITY_BAND: config.distanceBand,
    },
  );

  const totalPairs = selectedPairs.length;
  let processedCount = selectedPairs.length - pendingPairs.length;

  for (let i = 0; i < pendingPairs.length; i += batchSize) {
    await runtime.checkBudgetAndPause();

    const batch = pendingPairs.slice(i, i + batchSize);
    const batchPairMap = new Map<string, SelectedCrossingPair>();
    for (const pair of batch) {
      batchPairMap.set(buildPairKey(pair.mechanism.id, pair.problem.id), pair);
    }

    const usageTasks: Promise<void>[] = [];
    let deferredBudgetError: BudgetLimitExceededError | null = null;

    const onUsage = (usage: UsageReceipt): void => {
      const task = runtime
        .recordUsage(
          'phase3_cross',
          'crossing',
          crossingModel.provider,
          crossingModel.modelId,
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

    const userPayload = {
      instruction:
        'Generate structured biomimetic crossing candidates for the following mechanism-problem pairs.',
      pairs: batch.map(serializePairForCrossingPrompt),
    };

    const structured = await runtime.queue.enqueue(
      (qSignal) =>
        requestStructuredOutput({
          transport: runtime.transport,
          request: {
            provider: crossingModel.provider,
            modelId: crossingModel.modelId,
            role: 'crossing',
            temperature: crossingModel.temperature ?? 0.4,
            reasoningEffort: crossingModel.reasoningEffort,
            messages: [
              { role: 'system', content: crossingPrompt },
              { role: 'user', content: JSON.stringify(userPayload, null, 2) },
            ],
            metadata: {
              experimentId: runtime.experiment.id,
              phase: 'phase3_cross',
            },
          },
          schema: RawCrossingOutputSchema,
          schemaName: 'CrossingCandidatesOutput',
          signal: qSignal,
          onUsage,
        }),
      runtime.signal,
    );

    await Promise.all(usageTasks);

    const newCandidates: CrossingCandidate[] = [];
    const now = new Date().toISOString();

    for (const raw of structured.data.candidates) {
      const pairKey = buildPairKey(raw.mechanismId, raw.problemId);
      const pair = batchPairMap.get(pairKey);
      if (!pair) {
        runtime.emit({
          type: 'log',
          experimentId: runtime.experiment.id,
          level: 'warn',
          phase: 'phase3_cross',
          message: `Kreuzungs-Kandidat mit unbekanntem Paar (${pairKey}) verworfen.`,
          timestamp: now,
        });
        continue;
      }
      if (candidatesByPair.has(pairKey)) {
        continue;
      }

      const mechCitIds = resolveValidCitationIds(
        raw.mechanismCitationIds,
        pair.mechanism.citations.map((c) => c.id),
      );
      const probCitIds = resolveValidCitationIds(
        raw.problemCitationIds,
        pair.problem.citations.map((c) => c.id),
      );

      const candidate: CrossingCandidate = {
        id: `cand:${runtime.experiment.id}:${pair.mechanism.id}:${pair.problem.id}`,
        experimentId: runtime.experiment.id,
        mechanismId: pair.mechanism.id,
        problemId: pair.problem.id,
        strategyUsed,
        similarityScore: pair.similarityScore,
        distanceBand: config.distanceBand,
        bridgeTitle: raw.bridgeTitle,
        abstractTransferLogic: raw.abstractTransferLogic,
        proposedImplementationSketch: raw.proposedImplementationSketch,
        keyAssumptions: raw.keyAssumptions,
        potentialFailureModes: raw.potentialFailureModes,
        mechanismCitationIds: mechCitIds,
        problemCitationIds: probCitIds,
        createdAt: now,
      };

      candidatesByPair.set(pairKey, candidate);
      newCandidates.push(candidate);
    }

    if (newCandidates.length > 0) {
      await saveCandidates(newCandidates, runtime.db);
    }

    for (const pair of batch) {
      const key = buildPairKey(pair.mechanism.id, pair.problem.id);
      if (!completedPairs.has(key)) {
        completedPairs.add(key);
        runtime.experiment.checkpoint.completedPairKeys.push(key);
      }
    }
    await runtime.saveCheckpoint();

    processedCount += batch.length;
    runtime.emit({
      type: 'progress',
      experimentId: runtime.experiment.id,
      phase: 'phase3_cross',
      completed: processedCount,
      total: totalPairs,
      detail: `${newCandidates.length} Kandidat(en) in Batch erzeugt`,
      timestamp: new Date().toISOString(),
    });

    if (deferredBudgetError) {
      throw deferredBudgetError;
    }
  }

  return Array.from(candidatesByPair.values());
}
