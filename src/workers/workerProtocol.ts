import type {
  ConnectionTestResult,
  ProviderCredentials,
} from '@/ai';
import type {
  CostEstimate,
  ExperimentRun,
  ProviderId,
} from '@/core/schemas';
import type {
  CostEstimationInput,
  PricingOverrideMap,
} from '@/estimation';
import type {
  IngestFileInput,
  IngestedDocumentResult,
} from '@/ingestion';
import type { PipelineEvent } from '@/pipeline';

export interface WorkerTransportConfig {
  mode: 'direct-byok' | 'managed-proxy';
  credentialsByProvider?: Partial<Record<ProviderId, ProviderCredentials>>;
  managedProxyUrl?: string;
  authToken?: string;
}

export interface RunExperimentWorkerPayload {
  experimentId: string;
  transportConfig?: WorkerTransportConfig;
  pricingOverrides?: PricingOverrideMap;
  concurrency?: number;
  requestsPerMinute?: number;
}

export interface PauseExperimentWorkerPayload {
  experimentId: string;
  persistAsPaused?: boolean;
}

export interface ResumeExperimentWorkerPayload {
  experimentId: string;
}

export interface StopExperimentWorkerPayload {
  experimentId: string;
  persistAsPaused?: boolean;
}

export interface TestConnectionWorkerPayload {
  provider: ProviderId;
  modelId: string;
  transportConfig?: WorkerTransportConfig;
}

export type WorkerRequest =
  | {
      requestId: string;
      type: 'INGEST_DOCUMENT';
      payload: IngestFileInput;
    }
  | {
      requestId: string;
      type: 'ESTIMATE_COST';
      payload: CostEstimationInput;
    }
  | {
      requestId: string;
      type: 'RUN_EXPERIMENT';
      payload: RunExperimentWorkerPayload;
    }
  | {
      requestId: string;
      type: 'PAUSE_EXPERIMENT';
      payload: PauseExperimentWorkerPayload;
    }
  | {
      requestId: string;
      type: 'RESUME_EXPERIMENT';
      payload: ResumeExperimentWorkerPayload;
    }
  | {
      requestId: string;
      type: 'STOP_EXPERIMENT';
      payload: StopExperimentWorkerPayload;
    }
  | {
      requestId: string;
      type: 'TEST_CONNECTION';
      payload: TestConnectionWorkerPayload;
    };

export type WorkerRequestType = WorkerRequest['type'];

export interface WorkerResultMap {
  INGEST_DOCUMENT: IngestedDocumentResult;
  ESTIMATE_COST: CostEstimate;
  RUN_EXPERIMENT: ExperimentRun;
  PAUSE_EXPERIMENT: { paused: boolean };
  RESUME_EXPERIMENT: { resumed: boolean };
  STOP_EXPERIMENT: { stopped: boolean };
  TEST_CONNECTION: ConnectionTestResult;
}

export type WorkerResponse<T = unknown> =
  | {
      requestId: string;
      type: 'RPC_RESULT';
      result: T;
    }
  | {
      requestId: string;
      type: 'RPC_ERROR';
      error: {
        message: string;
        name?: string;
      };
    };

export interface WorkerEventMessage {
  type: 'PIPELINE_EVENT';
  event: PipelineEvent;
}

export type WorkerOutboundMessage = WorkerResponse | WorkerEventMessage;
