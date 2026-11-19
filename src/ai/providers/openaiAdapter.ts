import { assertNoExternalSearchTools } from '@/ai/guards/noWebSearchGuard';
import type {
  BuiltHttpRequest,
  IAIProviderAdapter,
  LLMMessage,
  NormalizedCompletionRequest,
  NormalizedCompletionResponse,
  NormalizedEmbeddingRequest,
  NormalizedEmbeddingResponse,
  ProviderCredentials,
} from '@/ai/types';

export type OpenAICompatibleProviderId =
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'custom';

const DEFAULT_BASE_URLS: Record<OpenAICompatibleProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  custom: 'http://localhost:11434/v1',
};

function normalizeBaseUrl(
  providerId: OpenAICompatibleProviderId,
  baseUrl?: string,
): string {
  return (baseUrl?.trim() || DEFAULT_BASE_URLS[providerId]).replace(/\/+$/, '');
}

function countVisionImages(messages: LLMMessage[]): number {
  return messages.reduce((sum, msg) => sum + (msg.images?.length ?? 0), 0);
}

function formatOpenAIMessage(msg: LLMMessage): Record<string, unknown> {
  if (!msg.images || msg.images.length === 0) {
    return {
      role: msg.role,
      content: msg.content,
    };
  }

  const contentParts: Array<Record<string, unknown>> = [];
  if (msg.content) {
    contentParts.push({ type: 'text', text: msg.content });
  }
  for (const img of msg.images) {
    contentParts.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType};base64,${img.dataBase64}`,
      },
    });
  }

  return {
    role: msg.role,
    content: contentParts,
  };
}

export class OpenAICompatibleAdapter implements IAIProviderAdapter {
  readonly providerId: OpenAICompatibleProviderId;

  constructor(providerId: OpenAICompatibleProviderId = 'openai') {
    this.providerId = providerId;
  }

  buildCompletionHttpRequest(
    req: NormalizedCompletionRequest,
    creds: ProviderCredentials,
  ): BuiltHttpRequest {
    const baseUrl = normalizeBaseUrl(this.providerId, creds.baseUrl);
    const url = `${baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(creds.extraHeaders ?? {}),
    };
    if (creds.apiKey) {
      headers.Authorization = `Bearer ${creds.apiKey}`;
    }
    if (this.providerId === 'openrouter') {
      headers['X-Title'] = headers['X-Title'] ?? 'BioBridge';
    }

    const body: Record<string, unknown> = {
      model: req.modelId,
      messages: req.messages.map(formatOpenAIMessage),
    };

    if (req.temperature !== undefined) {
      body.temperature = req.temperature;
    }
    if (req.maxTokens !== undefined) {
      body.max_tokens = req.maxTokens;
    }
    if (req.reasoningEffort) {
      const effort =
        req.reasoningEffort === 'extreme' ? 'xhigh' : req.reasoningEffort;
      if (this.providerId === 'openrouter') {
        body.reasoning = { effort };
      } else if (this.providerId === 'openai' || this.providerId === 'deepseek') {
        body.reasoning_effort = effort;
      }
    }
    if (req.responseFormat?.type === 'json_object') {
      body.response_format = { type: 'json_object' };
    } else if (req.responseFormat?.type === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: req.responseFormat.schemaName,
          strict: true,
          schema: req.responseFormat.jsonSchema,
        },
      };
    }

    assertNoExternalSearchTools(body);

    return { url, headers, body };
  }

  parseCompletionResponse(
    json: unknown,
    req: NormalizedCompletionRequest,
  ): NormalizedCompletionResponse {
    const data = (json ?? {}) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    };

    const rawContent = data.choices?.[0]?.message?.content;
    let text = '';
    if (typeof rawContent === 'string') {
      text = rawContent;
    } else if (Array.isArray(rawContent)) {
      text = rawContent
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('');
    }

    const visionImages = countVisionImages(req.messages);

    return {
      text,
      provider: this.providerId,
      modelId: req.modelId,
      finishReason: data.choices?.[0]?.finish_reason,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        ...(visionImages > 0 ? { visionImages } : {}),
      },
      raw: json,
    };
  }

  buildEmbeddingHttpRequest(
    req: NormalizedEmbeddingRequest,
    creds: ProviderCredentials,
  ): BuiltHttpRequest {
    const baseUrl = normalizeBaseUrl(this.providerId, creds.baseUrl);
    const url = `${baseUrl}/embeddings`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(creds.extraHeaders ?? {}),
    };
    if (creds.apiKey) {
      headers.Authorization = `Bearer ${creds.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: req.modelId,
      input: req.texts,
    };

    assertNoExternalSearchTools(body);

    return { url, headers, body };
  }

  parseEmbeddingResponse(
    json: unknown,
    req: NormalizedEmbeddingRequest,
  ): NormalizedEmbeddingResponse {
    const data = (json ?? {}) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };

    const sorted = [...(data.data ?? [])].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const embeddings = sorted.map((item) => item.embedding ?? []);

    return {
      embeddings,
      provider: this.providerId,
      modelId: req.modelId,
      usage: {
        inputTokens:
          data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0,
        outputTokens: 0,
      },
    };
  }
}
