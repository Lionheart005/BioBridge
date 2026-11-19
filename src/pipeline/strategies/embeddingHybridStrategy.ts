import type {
  CrossingCandidate,
  DistanceBand,
  ExtractedMechanism,
  ExtractedProblem,
} from '@/core/schemas';
import { getEmbeddings, saveEmbeddings, type EmbeddingRecord } from '@/storage';
import type { PipelineRuntimeContext } from '../orchestrator';
import {
  type CrossingContext,
  type ICrossingStrategy,
  type SelectedCrossingPair,
  executeCrossingBatches,
} from './crossingStrategy.interface';

const EMBEDDING_BATCH_SIZE = 64;

function tokenizeTerms(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu);
  return new Set(matches ?? []);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 0) {
    return 0;
  }
  return Math.max(-1, Math.min(1, dot / denom));
}

function computeCompatibilityBonus(
  mech: ExtractedMechanism,
  prob: ExtractedProblem,
): number {
  const mechTerms = tokenizeTerms(
    `${mech.boundaryConditions.spatialScale} ${mech.boundaryConditions.medium}`,
  );
  const probTerms = tokenizeTerms(
    `${prob.boundaryConditions.spatialScale} ${prob.boundaryConditions.medium}`,
  );
  return 0.08 * jaccardSimilarity(mechTerms, probTerms);
}

interface ScoredPair {
  mechanism: ExtractedMechanism;
  problem: ExtractedProblem;
  cosine: number;
  strictScore: number;
}

function selectWithMMR(
  pool: ScoredPair[],
  targetCount: number,
  creativityDistance: number,
  alreadySelected: ScoredPair[] = [],
): ScoredPair[] {
  const selected: ScoredPair[] = [...alreadySelected];
  const selectedKeys = new Set(
    alreadySelected.map((p) => `${p.mechanism.id}::${p.problem.id}`),
  );
  const mechCounts = new Map<string, number>();
  const probCounts = new Map<string, number>();

  for (const item of alreadySelected) {
    mechCounts.set(item.mechanism.id, (mechCounts.get(item.mechanism.id) ?? 0) + 1);
    probCounts.set(item.problem.id, (probCounts.get(item.problem.id) ?? 0) + 1);
  }

  const remaining = pool.filter(
    (p) => !selectedKeys.has(`${p.mechanism.id}::${p.problem.id}`),
  );

  // Higher creativityDistance => stronger diversity penalty against reusing same mech/prob
  const lambda = Math.max(0.45, Math.min(0.85, 0.78 - 0.28 * creativityDistance));

  while (selected.length < targetCount && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i += 1) {
      const cand = remaining[i];
      const mechReuse = mechCounts.get(cand.mechanism.id) ?? 0;
      const probReuse = probCounts.get(cand.problem.id) ?? 0;
      const diversityPenalty = Math.min(1, (mechReuse + probReuse) * 0.25);
      const mmr = lambda * cand.cosine - (1 - lambda) * diversityPenalty;

      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }

    const [chosen] = remaining.splice(bestIdx, 1);
    selected.push(chosen);
    mechCounts.set(chosen.mechanism.id, (mechCounts.get(chosen.mechanism.id) ?? 0) + 1);
    probCounts.set(chosen.problem.id, (probCounts.get(chosen.problem.id) ?? 0) + 1);
  }

  return selected;
}

export function selectPairsForDistanceBand(params: {
  allPairs: ScoredPair[];
  maxCandidates: number;
  distanceBand: DistanceBand;
  creativityDistance: number;
}): SelectedCrossingPair[] {
  const { allPairs, maxCandidates, distanceBand, creativityDistance } = params;
  const targetCount = Math.min(maxCandidates, allPairs.length);
  if (targetCount <= 0) {
    return [];
  }

  // Deterministic base ordering
  const byStrict = [...allPairs].sort((a, b) => {
    if (b.strictScore !== a.strictScore) return b.strictScore - a.strictScore;
    if (a.mechanism.id !== b.mechanism.id) {
      return a.mechanism.id.localeCompare(b.mechanism.id);
    }
    return a.problem.id.localeCompare(b.problem.id);
  });

  if (distanceBand === 'strict') {
    return byStrict.slice(0, targetCount).map((p) => ({
      mechanism: p.mechanism,
      problem: p.problem,
      similarityScore: p.cosine,
    }));
  }

  const byCosineDesc = [...allPairs].sort((a, b) => {
    if (b.cosine !== a.cosine) return b.cosine - a.cosine;
    if (a.mechanism.id !== b.mechanism.id) {
      return a.mechanism.id.localeCompare(b.mechanism.id);
    }
    return a.problem.id.localeCompare(b.problem.id);
  });

  if (distanceBand === 'balanced') {
    return selectWithMMR(byCosineDesc, targetCount, creativityDistance).map((p) => ({
      mechanism: p.mechanism,
      problem: p.problem,
      similarityScore: p.cosine,
    }));
  }

  // Exploratory: combine top hits with middle percentile band (50%-85%) + MMR
  const byCosineAsc = [...byCosineDesc].reverse();
  const n = byCosineAsc.length;
  const midStart = Math.floor(n * 0.5);
  const midEnd = Math.min(n, Math.max(midStart + 1, Math.ceil(n * 0.85)));
  const midBand = byCosineAsc.slice(midStart, midEnd).reverse();

  const topShare = Math.max(1, Math.round(targetCount * (0.5 - 0.2 * creativityDistance)));
  const topSeed = selectWithMMR(byCosineDesc, Math.min(topShare, targetCount), creativityDistance);
  const combined = selectWithMMR(
    midBand.length > 0 ? midBand : byCosineDesc,
    targetCount,
    creativityDistance,
    topSeed,
  );
  // Fill any remaining slots if midBand had fewer unique items
  const finalSelection =
    combined.length < targetCount
      ? selectWithMMR(byCosineDesc, targetCount, creativityDistance, combined)
      : combined;

  return finalSelection.map((p) => ({
    mechanism: p.mechanism,
    problem: p.problem,
    similarityScore: p.cosine,
  }));
}

async function ensureEmbeddings(
  runtime: PipelineRuntimeContext,
  items: Array<{ id: string; text: string }>,
): Promise<Map<string, number[]>> {
  const { provider, modelId } = runtime.experiment.config.modelAssignments.embedding;
  const ids = items.map((item) => item.id);
  const cached = await getEmbeddings(ids, modelId, runtime.db);

  const vectors = new Map<string, number[]>();
  for (const rec of cached) {
    vectors.set(rec.itemId, rec.vector);
  }

  const missing = items.filter((item) => !vectors.has(item.id));
  for (let i = 0; i < missing.length; i += EMBEDDING_BATCH_SIZE) {
    await runtime.checkBudgetAndPause();
    const batch = missing.slice(i, i + EMBEDDING_BATCH_SIZE);

    const response = await runtime.queue.enqueue(
      (qSignal) =>
        runtime.transport.sendEmbedding(
          {
            provider,
            modelId,
            texts: batch.map((b) => b.text),
            metadata: {
              experimentId: runtime.experiment.id,
            },
          },
          qSignal,
        ),
      runtime.signal,
    );

    const now = new Date().toISOString();
    const newRecords: EmbeddingRecord[] = [];
    for (let j = 0; j < batch.length; j += 1) {
      const vec = response.embeddings[j];
      if (!vec) {
        throw new Error(
          `Embedding provider returned missing vector at index ${j} for item "${batch[j].id}"`,
        );
      }
      vectors.set(batch[j].id, vec);
      newRecords.push({
        itemId: batch[j].id,
        modelId,
        cacheKey: `${provider}:${modelId}`,
        vector: vec,
        createdAt: now,
      });
    }

    await saveEmbeddings(newRecords, runtime.db);
    await runtime.recordUsage(
      'phase3_cross',
      'embedding',
      provider,
      modelId,
      response.usage,
    );
  }

  return vectors;
}

export class EmbeddingHybridStrategy implements ICrossingStrategy {
  readonly strategyId = 'embedding-hybrid' as const;

  async generateCandidates(ctx: CrossingContext): Promise<CrossingCandidate[]> {
    const { runtime, mechanisms, problems, existingCandidates } = ctx;
    if (mechanisms.length === 0 || problems.length === 0) {
      return existingCandidates;
    }

    const { config } = runtime.experiment;
    const embeddingItems = [
      ...mechanisms.map((m) => ({ id: m.id, text: m.functionalAbstract })),
      ...problems.map((p) => ({ id: p.id, text: p.functionalNeedAbstract })),
    ];

    const vectorMap = await ensureEmbeddings(runtime, embeddingItems);

    const allPairs: ScoredPair[] = [];
    for (const mech of mechanisms) {
      const mechVec = vectorMap.get(mech.id) ?? [];
      for (const prob of problems) {
        const probVec = vectorMap.get(prob.id) ?? [];
        const cosine = cosineSimilarity(mechVec, probVec);
        const bonus = computeCompatibilityBonus(mech, prob);
        allPairs.push({
          mechanism: mech,
          problem: prob,
          cosine,
          strictScore: cosine + bonus,
        });
      }
    }

    const selectedPairs = selectPairsForDistanceBand({
      allPairs,
      maxCandidates: config.maxCandidates,
      distanceBand: config.distanceBand,
      creativityDistance: config.creativityDistance,
    });

    return executeCrossingBatches({
      ctx,
      strategyUsed: this.strategyId,
      selectedPairs,
      batchSize: 4,
    });
  }
}
