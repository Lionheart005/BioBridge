import type {
  CostEstimate,
  ModelRole,
  PipelinePhase,
  ProviderId,
  ReasoningEffort,
} from '@/core/schemas';

export type LLMMessageRole = 'system' | 'user' | 'assistant';

export interface LLMImageAttachment {
  mimeType: string;
  dataBase64: string;
}

export interface LLMMessage {
  role: LLMMessageRole;
  content: string;
  images?: LLMImageAttachment[];
}

export type ResponseFormatSpec =
  | {
      type: 'json_schema';
      schemaName: string;
      jsonSchema: Record<string, unknown>;
    }
  | { type: 'json_object' }
  | { type: 'text' };

export interface RequestMetadata {
  experimentId?: string;
  phase?: PipelinePhase;
  quoteId?: string;
}

export interface NormalizedCompletionRequest {
  provider: ProviderId;
  modelId: string;
  role: ModelRole;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  responseFormat?: ResponseFormatSpec;
  metadata?: RequestMetadata;
}

export interface UsageReceipt {
  inputTokens: number;
  outputTokens: number;
  visionImages?: number;
  costUsd?: number;
  serverSignedReceiptId?: string;
}

export interface NormalizedCompletionResponse {
  text: string;
  provider: ProviderId;
  modelId: string;
  usage: UsageReceipt;
  finishReason?: string;
  raw?: unknown;
}

export interface NormalizedEmbeddingRequest {
  provider: ProviderId;
  modelId: string;
  texts: string[];
  metadata?: {
    experimentId?: string;
    quoteId?: string;
  };
}

export interface NormalizedEmbeddingResponse {
  embeddings: number[][];
  provider: ProviderId;
  modelId: string;
  usage: UsageReceipt;
}

export type ConnectionErrorKind =
  | 'AUTH_401'
  | 'CORS_BLOCKED'
  | 'RATE_LIMIT_429'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR';

export interface ConnectionTestResult {
  ok: boolean;
  errorKind?: ConnectionErrorKind;
  message: string;
  recommendation?: string;
  latencyMs?: number;
}

export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
  directBrowserAccess?: boolean;
  extraHeaders?: Record<string, string>;
}

export interface BuiltHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ITransportAdapter {
  readonly mode: 'direct-byok' | 'managed-proxy';
  sendCompletion(
    req: NormalizedCompletionRequest,
    signal?: AbortSignal,
  ): Promise<NormalizedCompletionResponse>;
  sendEmbedding(
    req: NormalizedEmbeddingRequest,
    signal?: AbortSignal,
  ): Promise<NormalizedEmbeddingResponse>;
  getAccountBalance?(): Promise<{ creditsUsd: number; currency: string }>;
  requestQuote?(
    estimate: CostEstimate,
  ): Promise<{ quoteId: string; maxChargeUsd: number }>;
  testConnection?(
    provider: ProviderId,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<ConnectionTestResult>;
}

export interface IAIProviderAdapter {
  readonly providerId: ProviderId;
  buildCompletionHttpRequest(
    req: NormalizedCompletionRequest,
    creds: ProviderCredentials,
  ): BuiltHttpRequest;
  parseCompletionResponse(
    json: unknown,
    req: NormalizedCompletionRequest,
  ): NormalizedCompletionResponse;
  buildEmbeddingHttpRequest?(
    req: NormalizedEmbeddingRequest,
    creds: ProviderCredentials,
  ): BuiltHttpRequest;
  parseEmbeddingResponse?(
    json: unknown,
    req: NormalizedEmbeddingRequest,
  ): NormalizedEmbeddingResponse;
}

export class TransportHttpError extends Error {
  readonly status?: number;
  readonly errorKind: ConnectionErrorKind;
  readonly retryAfterMs?: number;
  readonly provider?: ProviderId;

  constructor(params: {
    message: string;
    errorKind: ConnectionErrorKind;
    status?: number;
    retryAfterMs?: number;
    provider?: ProviderId;
  }) {
    super(params.message);
    this.name = 'TransportHttpError';
    this.status = params.status;
    this.errorKind = params.errorKind;
    this.retryAfterMs = params.retryAfterMs;
    this.provider = params.provider;
  }
}
