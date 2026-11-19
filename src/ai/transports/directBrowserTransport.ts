import { assertNoExternalSearchTools } from '@/ai/guards/noWebSearchGuard';
import { getProviderAdapter } from '@/ai/providers/providerRegistry';
import {
  type BuiltHttpRequest,
  type ConnectionTestResult,
  type ITransportAdapter,
  type NormalizedCompletionRequest,
  type NormalizedCompletionResponse,
  type NormalizedEmbeddingRequest,
  type NormalizedEmbeddingResponse,
  type ProviderCredentials,
  TransportHttpError,
} from '@/ai/types';
import type { ProviderId } from '@/core/schemas';

export interface DirectBrowserTransportOptions {
  getCredentials: (
    provider: ProviderId,
  ) => ProviderCredentials | Promise<ProviderCredentials>;
  fetchFn?: typeof fetch;
}

export function parseRetryAfterMs(retryAfterHeader: string | null): number | undefined {
  if (!retryAfterHeader) {
    return undefined;
  }
  const trimmed = retryAfterHeader.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1000));
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }
  return undefined;
}

function getCorsRecommendation(provider: ProviderId): string {
  switch (provider) {
    case 'anthropic':
      return 'Prüfe, ob Direct-Browser-Access aktiviert ist (Header anthropic-dangerous-direct-browser-access) oder nutze OpenRouter / den Option-B-Proxy.';
    case 'custom':
      return 'Für lokales Ollama muss OLLAMA_ORIGINS="*" (bzw. die App-Origin) gesetzt sein und der lokale Server laufen.';
    default:
      return 'Der Browser hat die Anfrage wegen CORS oder fehlender Netzwerkverbindung blockiert. Prüfe die Basis-URL, Browser-Erweiterungen oder nutze einen CORS-kompatiblen Endpunkt.';
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

export class DirectBrowserTransport implements ITransportAdapter {
  readonly mode = 'direct-byok' as const;
  private readonly getCredentials: DirectBrowserTransportOptions['getCredentials'];
  private readonly fetchFn: typeof fetch;

  constructor(options: DirectBrowserTransportOptions) {
    this.getCredentials = options.getCredentials;
    this.fetchFn =
      options.fetchFn ??
      ((input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input, init));
  }

  private async executeJsonRequest(
    provider: ProviderId,
    httpReq: BuiltHttpRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    assertNoExternalSearchTools(httpReq.body);

    let response: Response;
    try {
      response = await this.fetchFn(httpReq.url, {
        method: 'POST',
        headers: httpReq.headers,
        body: JSON.stringify(httpReq.body),
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      if (err instanceof TypeError) {
        throw new TransportHttpError({
          message: `CORS- oder Netzwerkblockade beim Aufruf von ${provider}: ${err.message}`,
          errorKind: 'CORS_BLOCKED',
          provider,
        });
      }
      throw new TransportHttpError({
        message:
          err instanceof Error
            ? `Netzwerkfehler (${provider}): ${err.message}`
            : `Unbekannter Netzwerkfehler (${provider})`,
        errorKind: 'NETWORK_ERROR',
        provider,
      });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const detail = errorBody ? `: ${errorBody.slice(0, 300)}` : '';

      if (
        response.status === 401 ||
        response.status === 403 ||
        (response.status === 400 &&
          /API_KEY_INVALID|API key not valid/i.test(errorBody))
      ) {
        throw new TransportHttpError({
          message: `Authentifizierung fehlgeschlagen (HTTP ${response.status}) für ${provider}${detail}`,
          errorKind: 'AUTH_401',
          status: response.status,
          provider,
        });
      }

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(
          response.headers.get('Retry-After'),
        );
        throw new TransportHttpError({
          message: `Rate-Limit erreicht (HTTP 429) für ${provider}${detail}`,
          errorKind: 'RATE_LIMIT_429',
          status: 429,
          retryAfterMs,
          provider,
        });
      }

      throw new TransportHttpError({
        message: `Provider-Fehler (HTTP ${response.status}) für ${provider}${detail}`,
        errorKind: 'PROVIDER_ERROR',
        status: response.status,
        provider,
      });
    }

    return response.json();
  }

  async sendCompletion(
    req: NormalizedCompletionRequest,
    signal?: AbortSignal,
  ): Promise<NormalizedCompletionResponse> {
    assertNoExternalSearchTools(req);
    const adapter = getProviderAdapter(req.provider);
    const creds = await this.getCredentials(req.provider);
    const httpReq = adapter.buildCompletionHttpRequest(req, creds);
    const json = await this.executeJsonRequest(req.provider, httpReq, signal);
    return adapter.parseCompletionResponse(json, req);
  }

  async sendEmbedding(
    req: NormalizedEmbeddingRequest,
    signal?: AbortSignal,
  ): Promise<NormalizedEmbeddingResponse> {
    assertNoExternalSearchTools(req);
    const adapter = getProviderAdapter(req.provider);
    if (!adapter.buildEmbeddingHttpRequest || !adapter.parseEmbeddingResponse) {
      throw new TransportHttpError({
        message: `Provider "${req.provider}" unterstützt keine Embeddings im Direct-Browser-Modus.`,
        errorKind: 'PROVIDER_ERROR',
        provider: req.provider,
      });
    }
    const creds = await this.getCredentials(req.provider);
    const httpReq = adapter.buildEmbeddingHttpRequest(req, creds);
    const json = await this.executeJsonRequest(req.provider, httpReq, signal);
    return adapter.parseEmbeddingResponse(json, req);
  }

  async testConnection(
    provider: ProviderId,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const creds = await this.getCredentials(provider);
      if (provider !== 'custom' && !creds.apiKey?.trim()) {
        return {
          ok: false,
          errorKind: 'AUTH_401',
          message: `Bitte zuerst einen API-Key für ${provider} eingeben.`,
          recommendation:
            'Bitte tragen Sie einen gültigen API-Key für diesen Anbieter ein und testen Sie erneut.',
          latencyMs: Date.now() - start,
        };
      }

      const isEmbeddingModel = /embed/i.test(modelId);
      if (isEmbeddingModel) {
        await this.sendEmbedding(
          {
            provider,
            modelId,
            texts: ['connection check'],
          },
          signal,
        );
      } else {
        await this.sendCompletion(
          {
            provider,
            modelId,
            role: 'extraction',
            messages: [{ role: 'user', content: 'Reply with OK.' }],
            temperature: 0,
            maxTokens: 64,
            reasoningEffort: 'low',
          },
          signal,
        );
      }
      return {
        ok: true,
        message: `Verbindung zu ${provider} (${modelId}) erfolgreich.`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      if (err instanceof TransportHttpError) {
        if (err.errorKind === 'AUTH_401') {
          return {
            ok: false,
            errorKind: 'AUTH_401',
            message: err.message,
            recommendation:
              'Bitte überprüfe den API-Key in den Einstellungen auf Tippfehler, Leerzeichen oder abgelaufene Berechtigungen.',
            latencyMs,
          };
        }
        if (err.errorKind === 'CORS_BLOCKED') {
          return {
            ok: false,
            errorKind: 'CORS_BLOCKED',
            message: err.message,
            recommendation: getCorsRecommendation(provider),
            latencyMs,
          };
        }
        if (err.errorKind === 'RATE_LIMIT_429') {
          return {
            ok: false,
            errorKind: 'RATE_LIMIT_429',
            message: err.message,
            recommendation:
              'API-Key ist gültig, aber das Kontingent / Rate-Limit ist aktuell erschöpft. Kurz warten oder Tier prüfen.',
            latencyMs,
          };
        }
        return {
          ok: false,
          errorKind: err.errorKind,
          message: err.message,
          recommendation:
            'Prüfe Modell-ID, Basis-URL und Provider-Status.',
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
