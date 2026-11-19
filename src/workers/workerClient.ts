import type { ConnectionTestResult, ITransportAdapter, SleepFn } from '@/ai';
import type { CostEstimate, ExperimentRun, ProviderId } from '@/core/schemas';
import {
  type CostEstimationInput,
  type PricingOverrideMap,
  estimateExperimentCost,
} from '@/estimation';
import {
  type IngestFileInput,
  type IngestedDocumentResult,
  detectFormat,
  ingestDocument as runIngestDocument,
} from '@/ingestion/ingestionRouter';
import {
  type PageImageProvider,
  type PipelineEvent,
  PipelineOrchestrator,
} from '@/pipeline';
import {
  type BioBridgeDB,
  db as defaultDb,
  saveDocumentWithPages,
} from '@/storage';
import { createTransportForWorker } from './pipeline.worker';
import type {
  RunExperimentWorkerPayload,
  WorkerOutboundMessage,
  WorkerRequest,
  WorkerRequestType,
  WorkerResultMap,
  WorkerTransportConfig,
} from './workerProtocol';

export interface PipelineWorkerClientOptions {
  db?: BioBridgeDB;
  transport?: ITransportAdapter;
  getTransportConfig?: () =>
    | WorkerTransportConfig
    | Promise<WorkerTransportConfig>;
  pricingOverrides?: PricingOverrideMap;
  pageImageProvider?: PageImageProvider;
  concurrency?: number;
  requestsPerMinute?: number;
  sleep?: SleepFn;
  forceMainThread?: boolean;
  workerFactory?: () => Worker;
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export class PipelineWorkerClient {
  private readonly options: PipelineWorkerClientOptions;
  private readonly database: BioBridgeDB;
  private readonly listeners = new Set<(event: PipelineEvent) => void>();
  private readonly pending = new Map<string, PendingRpc>();
  private readonly mainThreadOrchestrators = new Map<
    string,
    PipelineOrchestrator
  >();

  private worker: Worker | null = null;
  private disposed = false;
  private requestCounter = 0;

  constructor(options: PipelineWorkerClientOptions = {}) {
    this.options = options;
    this.database = options.db ?? defaultDb;
  }

  private get useWorker(): boolean {
    if (this.options.forceMainThread) {
      return false;
    }
    if (this.options.workerFactory) {
      return true;
    }
    return typeof Worker !== 'undefined';
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `rpc_${Date.now()}_${this.requestCounter}`;
  }

  private emitEvent(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private ensureWorker(): Worker {
    if (this.disposed) {
      throw new Error('PipelineWorkerClient has been disposed.');
    }
    if (this.worker) {
      return this.worker;
    }

    const worker = this.options.workerFactory
      ? this.options.workerFactory()
      : new Worker(new URL('./pipeline.worker.ts', import.meta.url), {
          type: 'module',
        });

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      if (msg.type === 'PIPELINE_EVENT') {
        this.emitEvent(msg.event);
        return;
      }

      const pending = this.pending.get(msg.requestId);
      if (!pending) {
        return;
      }
      this.pending.delete(msg.requestId);

      if (msg.type === 'RPC_RESULT') {
        pending.resolve(msg.result);
      } else {
        const err = new Error(msg.error.message);
        if (msg.error.name) {
          err.name = msg.error.name;
        }
        pending.reject(err);
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      const error = new Error(event.message || 'Web Worker error');
      if (this.worker === worker) {
        this.worker = null;
      }
      worker.terminate();
      for (const [reqId, pending] of this.pending.entries()) {
        this.pending.delete(reqId);
        pending.reject(error);
      }
    };

    worker.onmessageerror = () => {
      const error = new Error('Web Worker message deserialization error');
      for (const [reqId, pending] of this.pending.entries()) {
        this.pending.delete(reqId);
        pending.reject(error);
      }
    };

    this.worker = worker;
    return worker;
  }

  private sendRpc<K extends WorkerRequestType>(
    request: Extract<WorkerRequest, { type: K }>,
  ): Promise<WorkerResultMap[K]> {
    const worker = this.ensureWorker();
    return new Promise<WorkerResultMap[K]>((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      worker.postMessage(request);
    });
  }

  private async resolveTransportConfig(
    override?: WorkerTransportConfig,
  ): Promise<WorkerTransportConfig | undefined> {
    if (override) {
      return override;
    }
    if (this.options.getTransportConfig) {
      return this.options.getTransportConfig();
    }
    return undefined;
  }

  private async resolveMainThreadTransport(
    override?: WorkerTransportConfig,
  ): Promise<ITransportAdapter> {
    if (this.options.transport && !override) {
      return this.options.transport;
    }
    const cfg = await this.resolveTransportConfig(override);
    return createTransportForWorker(cfg, this.database);
  }

  onEvent(listener: (event: PipelineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async ingestDocument(
    input: IngestFileInput,
  ): Promise<IngestedDocumentResult> {
    const format = detectFormat(input.fileName, input.mimeType);
    // pdfjs-dist's display layer expects browser window/document globals and already
    // offloads heavy PDF decoding to its own dedicated pdf.worker.mjs Web Worker.
    // Running pdfjs-dist inside pipeline.worker.ts causes nested-worker / "document is not defined" errors.
    const shouldRunPdfOnMainThread =
      format === 'pdf' &&
      !this.options.workerFactory &&
      typeof window !== 'undefined' &&
      typeof document !== 'undefined';

    if (this.useWorker && !shouldRunPdfOnMainThread) {
      return this.sendRpc({
        requestId: this.nextRequestId(),
        type: 'INGEST_DOCUMENT',
        payload: input,
      });
    }

    const ingested = await runIngestDocument(input);
    const savedDoc = await saveDocumentWithPages(
      ingested.document,
      ingested.pages,
      this.database,
    );
    return {
      ...ingested,
      document: savedDoc,
    };
  }

  async estimateCost(input: CostEstimationInput): Promise<CostEstimate> {
    if (this.useWorker) {
      return this.sendRpc({
        requestId: this.nextRequestId(),
        type: 'ESTIMATE_COST',
        payload: input,
      });
    }
    return estimateExperimentCost(input);
  }

  async runExperiment(
    experimentId: string,
    runOptions: Omit<RunExperimentWorkerPayload, 'experimentId'> = {},
  ): Promise<ExperimentRun> {
    if (this.useWorker) {
      const transportConfig = await this.resolveTransportConfig(
        runOptions.transportConfig,
      );
      return this.sendRpc({
        requestId: this.nextRequestId(),
        type: 'RUN_EXPERIMENT',
        payload: {
          experimentId,
          transportConfig,
          pricingOverrides:
            runOptions.pricingOverrides ?? this.options.pricingOverrides,
          concurrency: runOptions.concurrency ?? this.options.concurrency,
          requestsPerMinute:
            runOptions.requestsPerMinute ?? this.options.requestsPerMinute,
        },
      });
    }

    const transport = await this.resolveMainThreadTransport(
      runOptions.transportConfig,
    );
    const orchestrator = new PipelineOrchestrator({
      db: this.database,
      transport,
      pricingOverrides:
        runOptions.pricingOverrides ?? this.options.pricingOverrides,
      concurrency: runOptions.concurrency ?? this.options.concurrency,
      requestsPerMinute:
        runOptions.requestsPerMinute ?? this.options.requestsPerMinute,
      sleep: this.options.sleep,
      pageImageProvider: this.options.pageImageProvider,
      onEvent: (event) => this.emitEvent(event),
    });

    this.mainThreadOrchestrators.set(experimentId, orchestrator);
    try {
      return await orchestrator.run(experimentId);
    } finally {
      if (this.mainThreadOrchestrators.get(experimentId) === orchestrator) {
        this.mainThreadOrchestrators.delete(experimentId);
      }
    }
  }

  async pauseExperiment(
    experimentId: string,
    persistAsPaused = false,
  ): Promise<{ paused: boolean }> {
    if (this.useWorker) {
      return this.sendRpc({
        requestId: this.nextRequestId(),
        type: 'PAUSE_EXPERIMENT',
        payload: { experimentId, persistAsPaused },
      });
    }

    const active = this.mainThreadOrchestrators.get(experimentId);
    if (!active) {
      return { paused: false };
    }
    if (persistAsPaused) {
      active.requestStopAsPaused();
    } else {
      active.pause();
    }
    return { paused: true };
  }

  async resumeExperiment(
    experimentId: string,
  ): Promise<{ resumed: boolean }> {
    if (this.useWorker) {
      return this.sendRpc({
        requestId: this.nextRequestId(),
        type: 'RESUME_EXPERIMENT',
        payload: { experimentId },
      });
    }

    const active = this.mainThreadOrchestrators.get(experimentId);
    if (!active) {
      return { resumed: false };
    }
    active.resume();
    return { resumed: true };
  }

  async stopExperiment(
    experimentId: string,
    persistAsPaused = false,
  ): Promise<{ stopped: boolean }> {
    if (this.useWorker) {
      return this.sendRpc({
        requestId: this.nextRequestId(),
        type: 'STOP_EXPERIMENT',
        payload: { experimentId, persistAsPaused },
      });
    }

    const active = this.mainThreadOrchestrators.get(experimentId);
    if (!active) {
      return { stopped: false };
    }
    if (persistAsPaused) {
      active.requestStopAsPaused();
    } else {
      active.abort('Stopped by user');
    }
    return { stopped: true };
  }

  async testConnection(
    provider: ProviderId,
    modelId: string,
    transportConfig?: WorkerTransportConfig,
  ): Promise<ConnectionTestResult> {
    const transport = await this.resolveMainThreadTransport(transportConfig);
    if (!transport.testConnection) {
      return {
        ok: false,
        errorKind: 'PROVIDER_ERROR',
        message: 'Aktiver Transport unterstützt keinen Verbindungstest.',
      };
    }
    return transport.testConnection(provider, modelId);
  }

  dispose(): void {
    this.disposed = true;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const active of this.mainThreadOrchestrators.values()) {
      active.abort('WorkerClient disposed');
    }
    this.mainThreadOrchestrators.clear();
    for (const [reqId, pending] of this.pending.entries()) {
      this.pending.delete(reqId);
      pending.reject(new Error('PipelineWorkerClient disposed'));
    }
    this.listeners.clear();
  }
}
