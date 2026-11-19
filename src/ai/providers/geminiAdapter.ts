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

const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

function normalizeBaseUrl(baseUrl?: string): string {
  const url = (baseUrl?.trim() || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
  return url;
}

function countVisionImages(messages: LLMMessage[]): number {
  return messages.reduce((sum, msg) => sum + (msg.images?.length ?? 0), 0);
}

function buildGeminiParts(msg: LLMMessage): GeminiPart[] {
  const parts: GeminiPart[] = [];
  if (msg.content) {
    parts.push({ text: msg.content });
  }
  if (msg.images) {
    for (const img of msg.images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.dataBase64,
        },
      });
    }
  }
  if (parts.length === 0) {
    parts.push({ text: '' });
  }
  return parts;
}

export class GeminiProviderAdapter implements IAIProviderAdapter {
  readonly providerId = 'gemini' as const;

  buildCompletionHttpRequest(
    req: NormalizedCompletionRequest,
    creds: ProviderCredentials,
  ): BuiltHttpRequest {
    const baseUrl = normalizeBaseUrl(creds.baseUrl);
    const modelPath = encodeURIComponent(req.modelId);
    const url = `${baseUrl}/models/${modelPath}:generateContent`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(creds.extraHeaders ?? {}),
    };
    if (creds.apiKey) {
      headers['x-goog-api-key'] = creds.apiKey;
    }

    const systemTexts: string[] = [];
    const contents: GeminiContent[] = [];

    for (const msg of req.messages) {
      if (msg.role === 'system') {
        if (msg.content.trim()) {
          systemTexts.push(msg.content);
        }
        continue;
      }
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: buildGeminiParts(msg),
      });
    }

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) {
      generationConfig.temperature = req.temperature;
    }
    if (req.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = req.maxTokens;
    }
    if (
      req.responseFormat?.type === 'json_schema' ||
      req.responseFormat?.type === 'json_object'
    ) {
      generationConfig.responseMimeType = 'application/json';
    }
    if (req.reasoningEffort && !/embed/i.test(req.modelId)) {
      generationConfig.thinkingConfig = {
        thinkingLevel:
          req.reasoningEffort === 'extreme' ? 'xhigh' : req.reasoningEffort,
      };
    }

    const body: Record<string, unknown> = {
      contents,
    };

    if (systemTexts.length > 0) {
      body.systemInstruction = {
        parts: [{ text: systemTexts.join('\n\n') }],
      };
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    assertNoExternalSearchTools(body);

    return { url, headers, body };
  }

  parseCompletionResponse(
    json: unknown,
    req: NormalizedCompletionRequest,
  ): NormalizedCompletionResponse {
    const data = (json ?? {}) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const nonThoughtParts = parts.filter((part) => !part.thought);
    const activeParts = nonThoughtParts.length > 0 ? nonThoughtParts : parts;
    const text = activeParts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('');

    const visionImages = countVisionImages(req.messages);
    const candidatesTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    const thoughtsTokens = data.usageMetadata?.thoughtsTokenCount ?? 0;

    return {
      text,
      provider: this.providerId,
      modelId: req.modelId,
      finishReason: candidate?.finishReason,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: candidatesTokens + thoughtsTokens,
        ...(visionImages > 0 ? { visionImages } : {}),
      },
      raw: json,
    };
  }

  buildEmbeddingHttpRequest(
    req: NormalizedEmbeddingRequest,
    creds: ProviderCredentials,
  ): BuiltHttpRequest {
    const baseUrl = normalizeBaseUrl(creds.baseUrl);
    const modelName = req.modelId.startsWith('models/')
      ? req.modelId
      : `models/${req.modelId}`;
    const encodedModel = encodeURIComponent(req.modelId.replace(/^models\//, ''));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(creds.extraHeaders ?? {}),
    };
    if (creds.apiKey) {
      headers['x-goog-api-key'] = creds.apiKey;
    }

    if (req.texts.length === 1) {
      const url = `${baseUrl}/models/${encodedModel}:embedContent`;
      const body: Record<string, unknown> = {
        model: modelName,
        content: { parts: [{ text: req.texts[0] }] },
      };
      assertNoExternalSearchTools(body);
      return { url, headers, body };
    }

    const url = `${baseUrl}/models/${encodedModel}:batchEmbedContents`;
    const body: Record<string, unknown> = {
      requests: req.texts.map((text) => ({
        model: modelName,
        content: { parts: [{ text }] },
      })),
    };
    assertNoExternalSearchTools(body);
    return { url, headers, body };
  }

  parseEmbeddingResponse(
    json: unknown,
    req: NormalizedEmbeddingRequest,
  ): NormalizedEmbeddingResponse {
    const data = (json ?? {}) as {
      embedding?: { values?: number[] };
      embeddings?: Array<{ values?: number[] }>;
    };

    let embeddings: number[][] = [];
    if (Array.isArray(data.embeddings)) {
      embeddings = data.embeddings.map((entry) => entry.values ?? []);
    } else if (data.embedding?.values) {
      embeddings = [data.embedding.values];
    }

    const estimatedInputTokens = req.texts.reduce(
      (sum, t) => sum + Math.max(1, Math.ceil(t.length / 4)),
      0,
    );

    return {
      embeddings,
      provider: this.providerId,
      modelId: req.modelId,
      usage: {
        inputTokens: estimatedInputTokens,
        outputTokens: 0,
      },
    };
  }
}
