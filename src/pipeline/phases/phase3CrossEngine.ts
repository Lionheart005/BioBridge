import type {
  CrossingCandidate,
  ExtractedMechanism,
  ExtractedProblem,
} from '@/core/schemas';
import { getCandidatesForExperiment } from '@/storage';
import type { PipelineRuntimeContext } from '../orchestrator';
import { ClusterBatchStrategy } from '../strategies/clusterBatchStrategy';
import type { ICrossingStrategy } from '../strategies/crossingStrategy.interface';
import { EmbeddingHybridStrategy } from '../strategies/embeddingHybridStrategy';

export function createCrossingStrategy(
  strategyType: 'embedding-hybrid' | 'cluster-batch',
): ICrossingStrategy {
  if (strategyType === 'cluster-batch') {
    return new ClusterBatchStrategy();
  }
  return new EmbeddingHybridStrategy();
}

/**
 * Phase 3: Dual Crossing Engine. Selects either `embedding-hybrid` or
 * `cluster-batch` strategy and returns normalized CrossingCandidates.
 */
export async function runPhase3CrossEngine(
  ctx: PipelineRuntimeContext,
  mechanisms: ExtractedMechanism[],
  problems: ExtractedProblem[],
): Promise<CrossingCandidate[]> {
  const existingCandidates = await getCandidatesForExperiment(
    ctx.experiment.id,
    ctx.db,
  );
  const strategy = createCrossingStrategy(ctx.experiment.config.crossingStrategy);

  return strategy.generateCandidates({
    runtime: ctx,
    mechanisms,
    problems,
    existingCandidates,
  });
}
