import { assertNoExternalSearchTools } from '@/ai/guards/noWebSearchGuard';
import type {
  BuiltHttpRequest,
  IAIProviderAdapter,
  LLMMessage,
  NormalizedCompletionRequest,
  NormalizedCompletionResponse,
  ProviderCredentials,
} from '@/ai/types';

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, '');
}

function countVisionImages(messages: LLMMessage[]): number {
  return messages.reduce((sum, msg) => sum + (msg.images?.length ?? 0), 0);
}

function formatAnthropicMessage(msg: LLMMessage): Record<string, unknown> {
  const role = msg.role === 'assistant' ? 'assistant' : 'user';
  if (!msg.images || msg.images.length === 0) {
    return {
      role,
      content: msg.content,
    };
  }

  const contentBlocks: Array<Record<string, unknown>> = [];
  for (const img of msg.images) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType,
        data: img.dataBase64,
      },
    });
  }
  if (msg.content) {
    contentBlocks.push({
      type: 'text',
      text: msg.content,
    });
  }

  return {
    role,
    content: contentBlocks,
  };
}

export class AnthropicProviderAdapter implements IAIProviderAdapter {
  readonly providerId = 'anthropic' as const;

  buildCompletionHttpRequest(
    req: NormalizedCompletionRequest,
    creds: ProviderCredentials,
  ): BuiltHttpRequest {
    const baseUrl = normalizeBaseUrl(creds.baseUrl);
    const url = `${baseUrl}/messages`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      ...(creds.extraHeaders ?? {}),
    };
    if (creds.apiKey) {
      headers['x-api-key'] = creds.apiKey;
    }
    if (creds.directBrowserAccess !== false) {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }

    const systemParts: string[] = [];
    const messages: Array<Record<string, unknown>> = [];

    for (const msg of req.messages) {
      if (msg.role === 'system') {
        if (msg.content.trim()) {
          systemParts.push(msg.content);
        }
        continue;
      }
      messages.push(formatAnthropicMessage(msg));
    }

    const body: Record<string, unknown> = {
      model: req.modelId,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
    };

    if (systemParts.length > 0) {
      body.system = systemParts.join('\n\n');
    }
    if (req.reasoningEffort) {
      body.thinking = { type: 'adaptive' };
      body.output_config = {
        effort: req.reasoningEffort === 'extreme' ? 'max' : req.reasoningEffort,
      };
    } else if (req.temperature !== undefined) {
      body.temperature = req.temperature;
    }

    assertNoExternalSearchTools(body);

    return { url, headers, body };
  }

  parseCompletionResponse(
    json: unknown,
    req: NormalizedCompletionRequest,
  ): NormalizedCompletionResponse {
    const data = (json ?? {}) as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text ?? '')
      .join('');

    const visionImages = countVisionImages(req.messages);

    return {
      text,
      provider: this.providerId,
      modelId: req.modelId,
      finishReason: data.stop_reason,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        ...(visionImages > 0 ? { visionImages } : {}),
      },
      raw: json,
    };
  }
}
