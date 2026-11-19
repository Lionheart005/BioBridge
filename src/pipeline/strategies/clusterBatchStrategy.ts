import { z } from 'zod';
import { requestStructuredOutput, type UsageReceipt } from '@/ai';
import type {
  ClusterSummary,
  CrossingCandidate,
  DistanceBand,
  Domain,
  ExtractedMechanism,
  ExtractedProblem,
} from '@/core/schemas';
import { CLUSTER_PROMPT, compilePrompt } from '@/prompts';
import type { PipelineRuntimeContext } from '../orchestrator';
import {
  BudgetLimitExceededError,
  type CrossingContext,
  type ICrossingStrategy,
  type SelectedCrossingPair,
  buildPairKey,
  executeCrossingBatches,
} from './crossingStrategy.interface';

const RawClusterOutputSchema = z.object({
  clusters: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string(),
      memberIds: z.array(z.string()),
    }),
  ),
});

function tokenize(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu);
  return new Set(matches ?? []);
}

function lexicalSimilarity(a: ClusterSummary, b: ClusterSummary): number {
  const tokensA = tokenize(`${a.label} ${a.description}`);
  const tokensB = tokenize(`${b.label} ${b.description}`);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection += 1;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

async function clusterDomainItems(params: {
  runtime: PipelineRuntimeContext;
  domain: Domain;
  items: Array<{ id: string; title: string; abstract: string }>;
}): Promise<ClusterSummary[]> {
  const { runtime, domain, items } = params;
  if (items.length === 0) {
    return [];
  }

  if (items.length <= 3) {
    return [
      {
        id: `${domain}-cluster-1`,
        domain,
        label: domain === 'biology' ? 'Biologische Kernmechanismen' : 'Technische Kernprobleme',
        description: items.map((i) => i.title).join('; '),
        memberIds: items.map((i) => i.id),
      },
    ];
  }

  await runtime.checkBudgetAndPause();

  const { config } = runtime.experiment;
  const crossingModel = config.modelAssignments.crossing;
  const targetClusters = String(Math.max(2, Math.min(8, Math.ceil(items.length / 3))));
  const systemPrompt = compilePrompt(
    config.promptProfileSnapshot.slots.cluster ?? CLUSTER_PROMPT,
    {
      OUTPUT_LANGUAGE: config.outputLanguage,
      DOMAIN: domain,
      TARGET_CLUSTERS: targetClusters,
    },
  );

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

  const structured = await runtime.queue.enqueue(
    (qSignal) =>
      requestStructuredOutput({
        transport: runtime.transport,
        request: {
          provider: crossingModel.provider,
          modelId: crossingModel.modelId,
          role: 'crossing',
          temperature: crossingModel.temperature ?? 0.3,
          reasoningEffort: crossingModel.reasoningEffort,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: JSON.stringify(
                {
                  domain,
                  items: items.map((item) => ({
                    id: item.id,
                    title: item.title,
                    functionalAbstract: item.abstract,
                  })),
                },
                null,
                2,
              ),
            },
          ],
          metadata: {
            experimentId: runtime.experiment.id,
            phase: 'phase3_cross',
          },
        },
        schema: RawClusterOutputSchema,
        schemaName: 'DomainClustersOutput',
        signal: qSignal,
        onUsage,
      }),
    runtime.signal,
  );

  await Promise.all(usageTasks);

  const validIds = new Set(items.map((i) => i.id));
  const assignedIds = new Set<string>();
  const clusters: ClusterSummary[] = [];

  for (const rawCluster of structured.data.clusters) {
    const filteredMembers = rawCluster.memberIds.filter((id) => validIds.has(id));
    if (filteredMembers.length === 0) {
      continue;
    }
    for (const id of filteredMembers) {
      assignedIds.add(id);
    }
    clusters.push({
      id: rawCluster.id,
      domain,
      label: rawCluster.label,
      description: rawCluster.description,
      memberIds: Array.from(new Set(filteredMembers)),
    });
  }

  // Deterministic fallback for any unassigned items
  const unassigned = items.filter((i) => !assignedIds.has(i.id)).map((i) => i.id);
  if (unassigned.length > 0) {
    if (clusters.length === 0) {
      clusters.push({
        id: `${domain}-cluster-fallback`,
        domain,
        label: domain === 'biology' ? 'Biologische Mechanismen' : 'Technische Probleme',
        description: 'Automatisch gruppierte Einträge',
        memberIds: unassigned,
      });
    } else {
      clusters[0].memberIds.push(...unassigned);
    }
  }

  if (deferredBudgetError) {
    throw deferredBudgetError;
  }

  return clusters;
}

function selectPairsFromClusters(params: {
  bioClusters: ClusterSummary[];
  techClusters: ClusterSummary[];
  mechanisms: ExtractedMechanism[];
  problems: ExtractedProblem[];
  maxCandidates: number;
  distanceBand: DistanceBand;
}): SelectedCrossingPair[] {
  const {
    bioClusters,
    techClusters,
    mechanisms,
    problems,
    maxCandidates,
    distanceBand,
  } = params;

  const mechMap = new Map(mechanisms.map((m) => [m.id, m]));
  const probMap = new Map(problems.map((p) => [p.id, p]));

  interface ClusterPair {
    bio: ClusterSummary;
    tech: ClusterSummary;
    overlap: number;
  }

  const clusterPairs: ClusterPair[] = [];
  for (const bio of bioClusters) {
    for (const tech of techClusters) {
      clusterPairs.push({
        bio,
        tech,
        overlap: lexicalSimilarity(bio, tech),
      });
    }
  }

  if (distanceBand === 'strict') {
    clusterPairs.sort((a, b) => b.overlap - a.overlap);
  } else if (distanceBand === 'exploratory') {
    // Prioritize structurally distant cluster pairs (lowest overlap first)
    clusterPairs.sort((a, b) => a.overlap - b.overlap);
  }

  // Expand cluster pairs round-robin so every cluster pair contributes diverse members
  const pairQueues: SelectedCrossingPair[][] = clusterPairs.map((cp) => {
    const expanded: SelectedCrossingPair[] = [];
    for (const mId of cp.bio.memberIds) {
      const mechanism = mechMap.get(mId);
      if (!mechanism) continue;
      for (const pId of cp.tech.memberIds) {
        const problem = probMap.get(pId);
        if (!problem) continue;
        expanded.push({ mechanism, problem });
      }
    }
    return expanded;
  });

  const selected: SelectedCrossingPair[] = [];
  const seenKeys = new Set<string>();
  let madeProgress = true;

  while (selected.length < maxCandidates && madeProgress) {
    madeProgress = false;
    for (const queue of pairQueues) {
      if (selected.length >= maxCandidates) {
        break;
      }
      while (queue.length > 0) {
        const next = queue.shift()!;
        const key = buildPairKey(next.mechanism.id, next.problem.id);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          selected.push(next);
          madeProgress = true;
          break;
        }
      }
    }
  }

  return selected;
}

export class ClusterBatchStrategy implements ICrossingStrategy {
  readonly strategyId = 'cluster-batch' as const;

  async generateCandidates(ctx: CrossingContext): Promise<CrossingCandidate[]> {
    const { runtime, mechanisms, problems, existingCandidates } = ctx;
    if (mechanisms.length === 0 || problems.length === 0) {
      return existingCandidates;
    }

    const { config } = runtime.experiment;

    const bioClusters = await clusterDomainItems({
      runtime,
      domain: 'biology',
      items: mechanisms.map((m) => ({
        id: m.id,
        title: m.title,
        abstract: m.functionalAbstract,
      })),
    });

    const techClusters = await clusterDomainItems({
      runtime,
      domain: 'technology',
      items: problems.map((p) => ({
        id: p.id,
        title: p.title,
        abstract: p.functionalNeedAbstract,
      })),
    });

    const selectedPairs = selectPairsFromClusters({
      bioClusters,
      techClusters,
      mechanisms,
      problems,
      maxCandidates: config.maxCandidates,
      distanceBand: config.distanceBand,
    });

    return executeCrossingBatches({
      ctx,
      strategyUsed: this.strategyId,
      selectedPairs,
      batchSize: 4,
    });
  }
}
