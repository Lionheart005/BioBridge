import {
  type ConnectionTestResult,
  DirectBrowserTransport,
  type ITransportAdapter,
  ManagedProxyTransport,
} from '@/ai';
import { estimateExperimentCost } from '@/estimation';
import { ingestDocument } from '@/ingestion/ingestionRouter';
import { PipelineOrchestrator } from '@/pipeline';
import {
  type BioBridgeDB,
  db as defaultDb,
  getAppSettings,
  saveDocumentWithPages,
} from '@/storage';
import type {
  WorkerOutboundMessage,
  WorkerRequest,
  WorkerTransportConfig,
} from './workerProtocol';

export async function createTransportForWorker(
  transportConfig: WorkerTransportConfig | undefined,
  database: BioBridgeDB = defaultDb,
): Promise<ITransportAdapter> {
  const settings = await getAppSettings(database);
  const mode = transportConfig?.mode ?? settings.transportMode;

  if (mode === 'managed-proxy') {
    const baseUrl =
      transportConfig?.managedProxyUrl ?? settings.managedProxyUrl ?? '';
    return new ManagedProxyTransport({
      baseUrl,
      getAuthToken: () => transportConfig?.authToken ?? '',
    });
  }

  return new DirectBrowserTransport({
    getCredentials: async (provider) => {
      const fromConfig = transportConfig?.credentialsByProvider?.[provider];
      const fromSettings = settings.providerEndpoints?.[provider];
      const mergedHeaders = {
        ...(fromSettings?.customHeaders ?? {}),
        ...(fromConfig?.extraHeaders ?? {}),
      };
      return {
        ...fromConfig,
        baseUrl: fromConfig?.baseUrl ?? fromSettings?.baseUrl,
        ...(Object.keys(mergedHeaders).length > 0
          ? { extraHeaders: mergedHeaders }
          : {}),
      };
    },
  });
}

export interface WorkerHandlerDeps {
  db?: BioBridgeDB;
  postMessage: (message: WorkerOutboundMessage) => void;
  transportFactory?: (
    config?: WorkerTransportConfig,
  ) => Promise<ITransportAdapter>;
}

export function createWorkerMessageHandler(deps: WorkerHandlerDeps) {
  const database = deps.db ?? defaultDb;
  const activeOrchestrators = new Map<string, PipelineOrchestrator>();

  const resolveTransport = async (
    config?: WorkerTransportConfig,
  ): Promise<ITransportAdapter> => {
    if (deps.transportFactory) {
      return deps.transportFactory(config);
    }
    return createTransportForWorker(config, database);
  };

  return async (request: WorkerRequest): Promise<void> => {
    const { requestId } = request;
    try {
      switch (request.type) {
        case 'INGEST_DOCUMENT': {
          const ingested = await ingestDocument(request.payload);
          const savedDoc = await saveDocumentWithPages(
            ingested.document,
            ingested.pages,
            database,
          );
          deps.postMessage({
            requestId,
            type: 'RPC_RESULT',
            result: {
              ...ingested,
              document: savedDoc,
            },
          });
          return;
        }

        case 'ESTIMATE_COST': {
          const estimate = estimateExperimentCost(request.payload);
          deps.postMessage({
            requestId,
            type: 'RPC_RESULT',
            result: estimate,
          });
          return;
        }

        case 'RUN_EXPERIMENT': {
          const {
            experimentId,
            transportConfig,
            pricingOverrides,
            concurrency,
            requestsPerMinute,
          } = request.payload;

          const transport = await resolveTransport(transportConfig);
          const orchestrator = new PipelineOrchestrator({
            db: database,
            transport,
            pricingOverrides,
            concurrency,
            requestsPerMinute,
            onEvent: (event) => {
              deps.postMessage({
                type: 'PIPELINE_EVENT',
                event,
              });
            },
          });

          activeOrchestrators.set(experimentId, orchestrator);
          try {
            const result = await orchestrator.run(experimentId);
            deps.postMessage({
              requestId,
              type: 'RPC_RESULT',
              result,
            });
          } finally {
            if (activeOrchestrators.get(experimentId) === orchestrator) {
              activeOrchestrators.delete(experimentId);
            }
          }
          return;
        }

        case 'PAUSE_EXPERIMENT': {
          const active = activeOrchestrators.get(request.payload.experimentId);
          if (active) {
            if (request.payload.persistAsPaused) {
              active.requestStopAsPaused();
            } else {
              active.pause();
            }
          }
          deps.postMessage({
            requestId,
            type: 'RPC_RESULT',
            result: { paused: active !== undefined },
          });
          return;
        }

        case 'RESUME_EXPERIMENT': {
          const active = activeOrchestrators.get(request.payload.experimentId);
          if (active) {
            active.resume();
          }
          deps.postMessage({
            requestId,
            type: 'RPC_RESULT',
            result: { resumed: active !== undefined },
          });
          return;
        }

        case 'STOP_EXPERIMENT': {
          const active = activeOrchestrators.get(request.payload.experimentId);
          if (active) {
            if (request.payload.persistAsPaused) {
              active.requestStopAsPaused();
            } else {
              active.abort('Stopped by user');
            }
          }
          deps.postMessage({
            requestId,
            type: 'RPC_RESULT',
            result: { stopped: active !== undefined },
          });
          return;
        }

        case 'TEST_CONNECTION': {
          const transport = await resolveTransport(
            request.payload.transportConfig,
          );
          let result: ConnectionTestResult;
          if (transport.testConnection) {
            result = await transport.testConnection(
              request.payload.provider,
              request.payload.modelId,
            );
          } else {
            result = {
              ok: false,
              errorKind: 'PROVIDER_ERROR',
              message:
                'Aktiver Transport unterstützt keinen Verbindungstest.',
            };
          }
          deps.postMessage({
            requestId,
            type: 'RPC_RESULT',
            result,
          });
          return;
        }
      }
    } catch (err) {
      deps.postMessage({
        requestId,
        type: 'RPC_ERROR',
        error: {
          message: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : undefined,
        },
      });
    }
  };
}

interface WorkerScopeLike {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerOutboundMessage) => void;
}

const isDedicatedWorkerEnv =
  typeof self !== 'undefined' &&
  typeof window === 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function';

if (isDedicatedWorkerEnv) {
  const workerSelf = self as unknown as WorkerScopeLike;
  const handleMessage = createWorkerMessageHandler({
    postMessage: (message) => workerSelf.postMessage(message),
  });
  workerSelf.onmessage = (event: MessageEvent<WorkerRequest>) => {
    void handleMessage(event.data);
  };
}
