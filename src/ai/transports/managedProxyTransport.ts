import { assertNoExternalSearchTools } from '@/ai/guards/noWebSearchGuard';
import { parseRetryAfterMs } from '@/ai/transports/directBrowserTransport';
import {
  type ConnectionTestResult,
  type ITransportAdapter,
  type NormalizedCompletionRequest,
  type NormalizedCompletionResponse,
  type NormalizedEmbeddingRequest,
  type NormalizedEmbeddingResponse,
  TransportHttpError,
} from '@/ai/types';
import type { CostEstimate, ProviderId } from '@/core/schemas';

export interface ManagedProxyTransportOptions {
  baseUrl: string;
  getAuthToken: () => string | Promise<string>;
  fetchFn?: typeof fetch;
}

export class ManagedProxyTransport implements ITransportAdapter {
  readonly mode = 'managed-proxy' as const;
  private readonly baseUrl: string;
  private readonly getAuthToken: ManagedProxyTransportOptions['getAuthToken'];
  private readonly fetchFn: typeof fetch;

  constructor(options: ManagedProxyTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getAuthToken = options.getAuthToken;
    this.fetchFn =
      options.fetchFn ??
      ((input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input, init));
  }

  private async requestJson<T>(
    path: string,
    options: {
      method: 'GET' | 'POST';
      body?: unknown;
      quoteId?: string;
      signal?: AbortSignal;
      provider?: ProviderId;
    },
  ): Promise<T> {
    if (options.body !== undefined) {
      assertNoExternalSearchTools(options.body);
    }

    const token = await this.getAuthToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (options.quoteId) {
      headers['X-BioBridge-Quote-Id'] = options.quoteId;
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
        signal: options.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      throw new TransportHttpError({
        message:
          err instanceof Error
            ? `Managed-Proxy Netzwerkfehler: ${err.message}`
            : 'Managed-Proxy Netzwerkfehler',
        errorKind: err instanceof TypeError ? 'CORS_BLOCKED' : 'NETWORK_ERROR',
        provider: options.provider,
      });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new TransportHttpError({
          message: `Managed-Proxy Authentifizierung fehlgeschlagen (HTTP ${response.status}): ${detail}`,
          errorKind: 'AUTH_401',
          status: response.status,
          provider: options.provider,
        });
      }
      if (response.status === 429) {
        throw new TransportHttpError({
          message: `Managed-Proxy Rate-Limit (HTTP 429): ${detail}`,
          errorKind: 'RATE_LIMIT_429',
          status: 429,
          retryAfterMs: parseRetryAfterMs(response.headers.get('Retry-After')),
          provider: options.provider,
        });
      }
      throw new TransportHttpError({
        message: `Managed-Proxy Fehler (HTTP ${response.status}): ${detail}`,
        errorKind: 'PROVIDER_ERROR',
        status: response.status,
        provider: options.provider,
      });
    }

    return (await response.json()) as T;
  }

  async sendCompletion(
    req: NormalizedCompletionRequest,
    signal?: AbortSignal,
  ): Promise<NormalizedCompletionResponse> {
    assertNoExternalSearchTools(req);
    return this.requestJson<NormalizedCompletionResponse>(
      '/v1/ai/completions',
      {
        method: 'POST',
        body: req,
        quoteId: req.metadata?.quoteId,
        signal,
        provider: req.provider,
      },
    );
  }

  async sendEmbedding(
    req: NormalizedEmbeddingRequest,
    signal?: AbortSignal,
  ): Promise<NormalizedEmbeddingResponse> {
    assertNoExternalSearchTools(req);
    return this.requestJson<NormalizedEmbeddingResponse>('/v1/ai/embeddings', {
      method: 'POST',
      body: req,
      quoteId: req.metadata?.quoteId,
      signal,
      provider: req.provider,
    });
  }

  async getAccountBalance(
    signal?: AbortSignal,
  ): Promise<{ creditsUsd: number; currency: string }> {
    return this.requestJson<{ creditsUsd: number; currency: string }>(
      '/v1/billing/balance',
      { method: 'GET', signal },
    );
  }

  async requestQuote(
    estimate: CostEstimate,
  ): Promise<{ quoteId: string; maxChargeUsd: number }> {
    return this.requestJson<{ quoteId: string; maxChargeUsd: number }>(
      '/v1/billing/quote',
      {
        method: 'POST',
        body: estimate,
      },
    );
  }

  async testConnection(
    provider: ProviderId,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      await this.getAccountBalance(signal);
      return {
        ok: true,
        message: `Managed-Proxy erreichbar für ${provider} (${modelId}).`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      if (err instanceof TransportHttpError) {
        return {
          ok: false,
          errorKind: err.errorKind,
          message: err.message,
          latencyMs,
        };
      }
      return {
        ok: false,
        errorKind: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : String(err),
        latencyMs,
      };
    }
  }
}
