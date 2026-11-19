import {
  type ITransportAdapter,
  RateLimitQueue,
  type SleepFn,
  type UsageReceipt,
} from '@/ai';
import type {
  CostLedger,
  CostLedgerEntry,
  CrossingCandidate,
  ExperimentRun,
  ModelRole,
  PipelineCheckpoint,
  PipelinePhase,
  ProviderId,
  SourceDocument,
  VerificationStatus,
} from '@/core/schemas';
import { getModelPricing, type PricingOverrideMap } from '@/estimation';
import {
  type BioBridgeDB,
  db as defaultDb,
  getCandidatesForExperiment,
  getDocumentById,
  getExperiment,
  getReviewsForExperiment,
  updateCheckpoint,
} from '@/storage';
import { runPhase1VisionEnrich } from './phases/phase1VisionEnrich';
import {
  type Phase2ExtractResult,
  loadCachedKnowledgeForExperiment,
  runPhase2BlindExtract,
} from './phases/phase2BlindExtract';
import { runPhase3CrossEngine } from './phases/phase3CrossEngine';
import { runPhase4CriticReview } from './phases/phase4CriticReview';
import {
  BudgetLimitExceededError,
  PipelinePausedError,
} from './strategies/crossingStrategy.interface';

export { BudgetLimitExceededError, PipelinePausedError };

export type PipelineEvent =
  | {
      type: 'phase_changed';
      experimentId: string;
      phase: PipelinePhase;
      message: string;
      timestamp: string;
    }
  | {
      type: 'progress';
      experimentId: string;
      phase: PipelinePhase;
      completed: number;
      total: number;
      detail?: string;
      timestamp: string;
    }
  | {
      type: 'log';
      experimentId: string;
      level: 'info' | 'warn' | 'error';
      phase: PipelinePhase;
      message: string;
      timestamp: string;
    }
  | {
      type: 'cost_updated';
      experimentId: string;
      ledger: CostLedger;
      budgetLimitUsd?: number;
      timestamp: string;
    }
  | {
      type: 'citation_verified';
      experimentId: string;
      documentTitle: string;
      pageNumber: number;
      status: VerificationStatus;
      attempts: number;
      timestamp: string;
    }
  | {
      type: 'budget_stopped';
      experimentId: string;
      totalCostUsd: number;
      budgetLimitUsd: number;
      timestamp: string;
    }
  | {
      type: 'paused';
      experimentId: string;
      phase: PipelinePhase;
      timestamp: string;
    }
  | {
      type: 'completed';
      experimentId: string;
      candidateCount: number;
      reviewCount: number;
      timestamp: string;
    }
  | {
      type: 'error';
      experimentId: string;
      phase: PipelinePhase;
      error: string;
      timestamp: string;
    };

export type PageImageProvider = (
  documentId: string,
  pageNumber: number,
) => Promise<{ mimeType: string; dataBase64: string } | null>;

export interface PipelineRuntimeContext {
  experiment: ExperimentRun;
  db: BioBridgeDB;
  transport: ITransportAdapter;
  queue: RateLimitQueue;
  pricingOverrides?: PricingOverrideMap;
  signal: AbortSignal;
  pageImageProvider?: PageImageProvider;
  emit: (event: PipelineEvent) => void;
  recordUsage: (
    phase: PipelinePhase,
    role: ModelRole,
    provider: ProviderId,
    modelId: string,
    usage: UsageReceipt,
  ) => Promise<void>;
  checkBudgetAndPause: () => Promise<void>;
  saveCheckpoint: () => Promise<void>;
}

export interface PipelineOrchestratorOptions {
  db?: BioBridgeDB;
  transport: ITransportAdapter;
  pricingOverrides?: PricingOverrideMap;
  concurrency?: number;
  requestsPerMinute?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  sleep?: SleepFn;
  pageImageProvider?: PageImageProvider;
  onEvent?: (event: PipelineEvent) => void;
}

function roundUsdPrecise(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

export function calculateUsageCostUsd(
  role: ModelRole,
  provider: ProviderId,
  modelId: string,
  usage: UsageReceipt,
  pricingOverrides?: PricingOverrideMap,
): number {
  if (usage.costUsd !== undefined) {
    return roundUsdPrecise(usage.costUsd);
  }
  const pricing = getModelPricing(provider, modelId, pricingOverrides);
  if (role === 'embedding') {
    const embRate = pricing.embeddingPer1MUsd ?? pricing.inputPer1MUsd;
    return roundUsdPrecise((usage.inputTokens / 1_000_000) * embRate);
  }
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPer1MUsd;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPer1MUsd;
  const visionCost =
    (usage.visionImages ?? 0) * (pricing.visionPerImageUsd ?? 0);
  return roundUsdPrecise(inputCost + outputCost + visionCost);
}

function cloneCheckpoint(cp: PipelineCheckpoint): PipelineCheckpoint {
  return {
    currentPhase: cp.currentPhase,
    completedVisionPageKeys: [...cp.completedVisionPageKeys],
    completedChunkKeys: [...cp.completedChunkKeys],
    completedPairKeys: [...cp.completedPairKeys],
    completedReviewKeys: [...cp.completedReviewKeys],
    ...(cp.lastError !== undefined ? { lastError: cp.lastError } : {}),
  };
}

function cloneLedger(ledger: CostLedger): CostLedger {
  return {
    totalInputTokens: ledger.totalInputTokens,
    totalOutputTokens: ledger.totalOutputTokens,
    totalVisionImages: ledger.totalVisionImages,
    totalCostUsd: ledger.totalCostUsd,
    entries: ledger.entries.map((e) => ({ ...e })),
  };
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function createAbortError(message = 'Pipeline aborted'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export class PipelineOrchestrator {
  private readonly db: BioBridgeDB;
  private readonly transport: ITransportAdapter;
  private readonly pricingOverrides?: PricingOverrideMap;
  private readonly concurrency: number;
  private readonly requestsPerMinute: number;
  private readonly maxRetries?: number;
  private readonly baseBackoffMs?: number;
  private readonly maxBackoffMs?: number;
  private readonly sleep?: SleepFn;
  private readonly pageImageProvider?: PageImageProvider;
  private readonly onEvent?: (event: PipelineEvent) => void;

  private activeQueue: RateLimitQueue | null = null;
  private runAbortController: AbortController | null = null;
  private activeExperiment: ExperimentRun | null = null;
  private paused = false;
  private stopAsPausedRequested = false;
  private pauseWaiters: Array<() => void> = [];

  constructor(options: PipelineOrchestratorOptions) {
    this.db = options.db ?? defaultDb;
    this.transport = options.transport;
    this.pricingOverrides = options.pricingOverrides;
    this.concurrency = options.concurrency ?? 3;
    this.requestsPerMinute = options.requestsPerMinute ?? 60;
    this.maxRetries = options.maxRetries;
    this.baseBackoffMs = options.baseBackoffMs;
    this.maxBackoffMs = options.maxBackoffMs;
    this.sleep = options.sleep;
    this.pageImageProvider = options.pageImageProvider;
    this.onEvent = options.onEvent;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * In-session pause: pauses the RateLimitQueue and holds the orchestrator
   * until `resume()`, `requestStopAsPaused()`, or `abort()` is called.
   */
  pause(): void {
    this.paused = true;
    this.activeQueue?.pause();
    if (this.activeExperiment) {
      this.emitEvent({
        type: 'paused',
        experimentId: this.activeExperiment.id,
        phase: this.activeExperiment.checkpoint.currentPhase,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Resumes an in-session pause.
   */
  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    const waiters = this.pauseWaiters.splice(0);
    for (const wake of waiters) {
      wake();
    }
    this.activeQueue?.resume();
  }

  /**
   * Requests the active run to stop cleanly and persist status `PAUSED`
   * at its current checkpoint so a new orchestrator can resume later.
   */
  requestStopAsPaused(): void {
    this.stopAsPausedRequested = true;
    this.paused = false;
    const waiters = this.pauseWaiters.splice(0);
    for (const wake of waiters) {
      wake();
    }
    this.runAbortController?.abort('Paused by user');
    this.activeQueue?.abort('Paused by user');
  }

  /**
   * Alias for `requestStopAsPaused()`.
   */
  pauseAndStop(): void {
    this.requestStopAsPaused();
  }

  /**
   * Hard abort: cancels the active run as `FAILED`.
   */
  abort(reason = 'Pipeline aborted by user'): void {
    this.stopAsPausedRequested = false;
    this.paused = false;
    const waiters = this.pauseWaiters.splice(0);
    for (const wake of waiters) {
      wake();
    }
    this.runAbortController?.abort(reason);
    this.activeQueue?.abort(reason);
  }

  private emitEvent(event: PipelineEvent): void {
    this.onEvent?.(event);
  }

  private async loadDocs(ids: string[]): Promise<SourceDocument[]> {
    const docs: SourceDocument[] = [];
    for (const id of ids) {
      const doc = await getDocumentById(id, this.db);
      if (!doc) {
        throw new Error(`SourceDocument not found in IndexedDB: ${id}`);
      }
      docs.push(doc);
    }
    return docs;
  }

  private async waitIfPaused(signal: AbortSignal): Promise<void> {
    while (
      this.paused &&
      !this.stopAsPausedRequested &&
      !signal.aborted
    ) {
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.pauseWaiters.push(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
      });
    }
  }

  async run(experimentId: string): Promise<ExperimentRun> {
    const loaded = await getExperiment(experimentId, this.db);
    if (!loaded) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    const experiment: ExperimentRun = {
      ...loaded,
      checkpoint: cloneCheckpoint(loaded.checkpoint),
      costLedger: cloneLedger(loaded.costLedger),
    };

    if (
      experiment.status === 'COMPLETED' &&
      experiment.checkpoint.currentPhase === 'completed'
    ) {
      const [cands, revs] = await Promise.all([
        getCandidatesForExperiment(experiment.id, this.db),
        getReviewsForExperiment(experiment.id, this.db),
      ]);
      this.emitEvent({
        type: 'completed',
        experimentId: experiment.id,
        candidateCount: cands.length,
        reviewCount: revs.length,
        timestamp: new Date().toISOString(),
      });
      return experiment;
    }

    this.paused = false;
    this.stopAsPausedRequested = false;
    this.pauseWaiters = [];
    this.activeExperiment = experiment;
    this.runAbortController = new AbortController();
    const queue = new RateLimitQueue({
      concurrency: this.concurrency,
      requestsPerMinute: this.requestsPerMinute,
      ...(this.maxRetries !== undefined ? { maxRetries: this.maxRetries } : {}),
      ...(this.baseBackoffMs !== undefined
        ? { baseBackoffMs: this.baseBackoffMs }
        : {}),
      ...(this.maxBackoffMs !== undefined
        ? { maxBackoffMs: this.maxBackoffMs }
        : {}),
      ...(this.sleep !== undefined ? { sleep: this.sleep } : {}),
    });
    this.activeQueue = queue;

    let persistChain: Promise<void> = Promise.resolve();
    const enqueuePersist = (fn: () => Promise<void>): Promise<void> => {
      const next = persistChain.then(fn, fn);
      persistChain = next.catch(() => undefined);
      return next;
    };

    // Transition to RUNNING
    experiment.status = 'RUNNING';
    delete experiment.checkpoint.lastError;
    await enqueuePersist(() =>
      updateCheckpoint(
        experiment.id,
        cloneCheckpoint(experiment.checkpoint),
        'RUNNING',
        cloneLedger(experiment.costLedger),
        this.db,
      ),
    );

    const signal = this.runAbortController.signal;

    const ctx: PipelineRuntimeContext = {
      experiment,
      db: this.db,
      transport: this.transport,
      queue,
      pricingOverrides: this.pricingOverrides,
      signal,
      pageImageProvider: this.pageImageProvider,
      emit: (event) => this.emitEvent(event),
      recordUsage: async (phase, role, provider, modelId, usage) => {
        const now = new Date().toISOString();
        const costUsd = calculateUsageCostUsd(
          role,
          provider,
          modelId,
          usage,
          this.pricingOverrides,
        );

        const entry: CostLedgerEntry = {
          timestamp: now,
          phase,
          role,
          provider,
          modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...(usage.visionImages !== undefined
            ? { visionImages: usage.visionImages }
            : {}),
          costUsd,
        };

        experiment.costLedger.entries.push(entry);
        experiment.costLedger.totalInputTokens += usage.inputTokens;
        experiment.costLedger.totalOutputTokens += usage.outputTokens;
        experiment.costLedger.totalVisionImages += usage.visionImages ?? 0;
        experiment.costLedger.totalCostUsd = roundUsdPrecise(
          experiment.costLedger.totalCostUsd + costUsd,
        );

        const ledgerSnapshot = cloneLedger(experiment.costLedger);
        const checkpointSnapshot = cloneCheckpoint(experiment.checkpoint);

        await enqueuePersist(() =>
          updateCheckpoint(
            experiment.id,
            checkpointSnapshot,
            undefined,
            ledgerSnapshot,
            this.db,
          ),
        );

        this.emitEvent({
          type: 'cost_updated',
          experimentId: experiment.id,
          ledger: ledgerSnapshot,
          budgetLimitUsd: experiment.config.budgetLimitUsd,
          timestamp: now,
        });

        const budgetLimit = experiment.config.budgetLimitUsd;
        if (
          budgetLimit !== undefined &&
          experiment.costLedger.totalCostUsd >= budgetLimit
        ) {
          throw new BudgetLimitExceededError(
            experiment.costLedger.totalCostUsd,
            budgetLimit,
          );
        }
      },
      checkBudgetAndPause: async () => {
        if (this.stopAsPausedRequested) {
          throw new PipelinePausedError(experiment.checkpoint.currentPhase);
        }
        if (signal.aborted) {
          throw createAbortError();
        }
        await this.waitIfPaused(signal);
        if (this.stopAsPausedRequested) {
          throw new PipelinePausedError(experiment.checkpoint.currentPhase);
        }
        if (signal.aborted) {
          throw createAbortError();
        }
        const budgetLimit = experiment.config.budgetLimitUsd;
        if (
          budgetLimit !== undefined &&
          experiment.costLedger.totalCostUsd >= budgetLimit
        ) {
          throw new BudgetLimitExceededError(
            experiment.costLedger.totalCostUsd,
            budgetLimit,
          );
        }
      },
      saveCheckpoint: async () => {
        const checkpointSnapshot = cloneCheckpoint(experiment.checkpoint);
        const ledgerSnapshot = cloneLedger(experiment.costLedger);
        await enqueuePersist(() =>
          updateCheckpoint(
            experiment.id,
            checkpointSnapshot,
            undefined,
            ledgerSnapshot,
            this.db,
          ),
        );
      },
    };

    try {
      const biologyDocs = await this.loadDocs(experiment.biologyDocIds);
      const technologyDocs = await this.loadDocs(experiment.technologyDocIds);

      if (
        experiment.checkpoint.currentPhase === 'idle' ||
        experiment.checkpoint.currentPhase === 'phase1_vision'
      ) {
        experiment.checkpoint.currentPhase = 'phase1_vision';
        await ctx.saveCheckpoint();
        this.emitEvent({
          type: 'phase_changed',
          experimentId: experiment.id,
          phase: 'phase1_vision',
          message: 'Phase 1b: Optionale Diagramm- & Formel-Vision-Analyse',
          timestamp: new Date().toISOString(),
        });
        await ctx.checkBudgetAndPause();
        await runPhase1VisionEnrich(ctx, [...biologyDocs, ...technologyDocs]);
        experiment.checkpoint.currentPhase = 'phase2_extract';
        await ctx.saveCheckpoint();
      }

      let extracted: Phase2ExtractResult | null = null;
      if (experiment.checkpoint.currentPhase === 'phase2_extract') {
        this.emitEvent({
          type: 'phase_changed',
          experimentId: experiment.id,
          phase: 'phase2_extract',
          message: 'Phase 2: Strikte Blind-Extraktion & Zitatprüfung',
          timestamp: new Date().toISOString(),
        });
        await ctx.checkBudgetAndPause();
        extracted = await runPhase2BlindExtract(ctx, biologyDocs, technologyDocs);
        experiment.checkpoint.currentPhase = 'phase3_cross';
        await ctx.saveCheckpoint();
      }

      let candidates: CrossingCandidate[] | null = null;
      if (experiment.checkpoint.currentPhase === 'phase3_cross') {
        if (!extracted) {
          extracted = await loadCachedKnowledgeForExperiment(
            ctx,
            biologyDocs,
            technologyDocs,
          );
        }
        this.emitEvent({
          type: 'phase_changed',
          experimentId: experiment.id,
          phase: 'phase3_cross',
          message: `Phase 3: Kreuzungs-Engine (${experiment.config.crossingStrategy})`,
          timestamp: new Date().toISOString(),
        });
        await ctx.checkBudgetAndPause();
        candidates = await runPhase3CrossEngine(
          ctx,
          extracted.mechanisms,
          extracted.problems,
        );
        experiment.checkpoint.currentPhase = 'phase4_critic';
        await ctx.saveCheckpoint();
      }

      if (experiment.checkpoint.currentPhase === 'phase4_critic') {
        if (!extracted) {
          extracted = await loadCachedKnowledgeForExperiment(
            ctx,
            biologyDocs,
            technologyDocs,
          );
        }
        if (!candidates) {
          candidates = await getCandidatesForExperiment(experiment.id, this.db);
        }
        this.emitEvent({
          type: 'phase_changed',
          experimentId: experiment.id,
          phase: 'phase4_critic',
          message: 'Phase 4: Isolierter Advocatus Diaboli & Regelprüfung',
          timestamp: new Date().toISOString(),
        });
        await ctx.checkBudgetAndPause();
        const reviews = await runPhase4CriticReview(
          ctx,
          candidates,
          extracted.mechanisms,
          extracted.problems,
        );

        experiment.checkpoint.currentPhase = 'completed';
        experiment.status = 'COMPLETED';
        await enqueuePersist(() =>
          updateCheckpoint(
            experiment.id,
            cloneCheckpoint(experiment.checkpoint),
            'COMPLETED',
            cloneLedger(experiment.costLedger),
            this.db,
          ),
        );

        const completedTs = new Date().toISOString();
        this.emitEvent({
          type: 'phase_changed',
          experimentId: experiment.id,
          phase: 'completed',
          message: 'Analyse abgeschlossen',
          timestamp: completedTs,
        });
        this.emitEvent({
          type: 'completed',
          experimentId: experiment.id,
          candidateCount: candidates.length,
          reviewCount: reviews.length,
          timestamp: completedTs,
        });
      }

      return (await getExperiment(experiment.id, this.db)) ?? experiment;
    } catch (err) {
      await persistChain.catch(() => undefined);

      if (err instanceof BudgetLimitExceededError) {
        queue.abort('Budget limit exceeded');
        experiment.status = 'BUDGET_STOPPED';
        experiment.checkpoint.lastError = err.message;
        await updateCheckpoint(
          experiment.id,
          cloneCheckpoint(experiment.checkpoint),
          'BUDGET_STOPPED',
          cloneLedger(experiment.costLedger),
          this.db,
        );
        this.emitEvent({
          type: 'budget_stopped',
          experimentId: experiment.id,
          totalCostUsd: err.totalCostUsd,
          budgetLimitUsd: err.budgetLimitUsd,
          timestamp: new Date().toISOString(),
        });
        return (await getExperiment(experiment.id, this.db)) ?? experiment;
      }

      if (
        err instanceof PipelinePausedError ||
        (isAbortError(err) && this.stopAsPausedRequested)
      ) {
        queue.abort('Paused by user');
        experiment.status = 'PAUSED';
        await updateCheckpoint(
          experiment.id,
          cloneCheckpoint(experiment.checkpoint),
          'PAUSED',
          cloneLedger(experiment.costLedger),
          this.db,
        );
        this.emitEvent({
          type: 'paused',
          experimentId: experiment.id,
          phase: experiment.checkpoint.currentPhase,
          timestamp: new Date().toISOString(),
        });
        return (await getExperiment(experiment.id, this.db)) ?? experiment;
      }

      queue.abort('Pipeline failed');
      const errorMessage = err instanceof Error ? err.message : String(err);
      experiment.status = 'FAILED';
      experiment.checkpoint.lastError = errorMessage;
      await updateCheckpoint(
        experiment.id,
        cloneCheckpoint(experiment.checkpoint),
        'FAILED',
        cloneLedger(experiment.costLedger),
        this.db,
      );
      this.emitEvent({
        type: 'error',
        experimentId: experiment.id,
        phase: experiment.checkpoint.currentPhase,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
      throw err;
    } finally {
      this.activeQueue = null;
      this.runAbortController = null;
      this.activeExperiment = null;
      this.paused = false;
      this.stopAsPausedRequested = false;
      this.pauseWaiters = [];
    }
  }
}
