import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type {
  ITransportAdapter,
  LLMMessage,
  NormalizedCompletionRequest,
  UsageReceipt,
} from '@/ai/types';

export class StructuredOutputError extends Error {
  readonly rawText: string;
  readonly repairAttempts: number;
  readonly validationErrors: string[];
  readonly totalUsage: UsageReceipt;

  constructor(params: {
    message: string;
    rawText: string;
    repairAttempts: number;
    validationErrors: string[];
    totalUsage: UsageReceipt;
  }) {
    super(params.message);
    this.name = 'StructuredOutputError';
    this.rawText = params.rawText;
    this.repairAttempts = params.repairAttempts;
    this.validationErrors = params.validationErrors;
    this.totalUsage = params.totalUsage;
  }
}

function tryParseJson(candidate: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function extractBalancedJsonSlices(text: string): string[] {
  const results: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    const ch = text[start];
    if (ch !== '{' && ch !== '[') {
      continue;
    }
    const stack: string[] = [ch === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < text.length; i += 1) {
      const c = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === '"') {
          inString = false;
        }
        continue;
      }

      if (c === '"') {
        inString = true;
      } else if (c === '{') {
        stack.push('}');
      } else if (c === '[') {
        stack.push(']');
      } else if (c === '}' || c === ']') {
        if (stack[stack.length - 1] !== c) {
          break;
        }
        stack.pop();
        if (stack.length === 0) {
          results.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return results;
}

export function extractJsonFromText(rawText: string): {
  ok: true;
  value: unknown;
} | {
  ok: false;
  error: string;
} {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: false, error: 'Empty response text; expected valid JSON.' };
  }

  const direct = tryParseJson(trimmed);
  if (direct.ok) {
    return direct;
  }

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = fenceRegex.exec(trimmed);
  while (match !== null) {
    const fenced = match[1].trim();
    const parsedFence = tryParseJson(fenced);
    if (parsedFence.ok) {
      return parsedFence;
    }
    match = fenceRegex.exec(trimmed);
  }

  const slices = extractBalancedJsonSlices(trimmed);
  for (const slice of slices) {
    const parsedSlice = tryParseJson(slice);
    if (parsedSlice.ok) {
      return parsedSlice;
    }
  }

  return direct;
}

function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
}

function accumulateUsage(target: UsageReceipt, delta: UsageReceipt): void {
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  if (delta.visionImages !== undefined) {
    target.visionImages = (target.visionImages ?? 0) + delta.visionImages;
  }
  if (delta.costUsd !== undefined) {
    target.costUsd = (target.costUsd ?? 0) + delta.costUsd;
  }
  if (delta.serverSignedReceiptId) {
    target.serverSignedReceiptId = delta.serverSignedReceiptId;
  }
}

function buildJsonSchemaObject(
  schema: z.ZodTypeAny,
  schemaName: string,
): Record<string, unknown> {
  const generated = zodToJsonSchema(schema, {
    name: schemaName,
    $refStrategy: 'none',
  }) as Record<string, unknown>;

  if (
    generated.definitions &&
    typeof generated.definitions === 'object' &&
    schemaName in (generated.definitions as Record<string, unknown>)
  ) {
    return (generated.definitions as Record<string, Record<string, unknown>>)[
      schemaName
    ];
  }
  return generated;
}

export interface RequestStructuredOutputParams<T extends z.ZodTypeAny> {
  transport: ITransportAdapter;
  request: NormalizedCompletionRequest;
  schema: T;
  schemaName: string;
  maxRepairAttempts?: number;
  signal?: AbortSignal;
  onUsage?: (usage: UsageReceipt) => void;
}

export interface StructuredOutputResult<TData> {
  data: TData;
  rawText: string;
  repairAttempts: number;
  totalUsage: UsageReceipt;
}

export async function requestStructuredOutput<T extends z.ZodTypeAny>(
  params: RequestStructuredOutputParams<T>,
): Promise<StructuredOutputResult<z.infer<T>>> {
  const maxRepairAttempts = params.maxRepairAttempts ?? 2;
  const jsonSchema = buildJsonSchemaObject(params.schema, params.schemaName);

  const totalUsage: UsageReceipt = {
    inputTokens: 0,
    outputTokens: 0,
  };

  let messages: LLMMessage[] = [...params.request.messages];
  let lastRawText = '';
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    if (params.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const reqForAttempt: NormalizedCompletionRequest = {
      ...params.request,
      messages,
      responseFormat: params.request.responseFormat ?? {
        type: 'json_schema',
        schemaName: params.schemaName,
        jsonSchema,
      },
    };

    const response = await params.transport.sendCompletion(
      reqForAttempt,
      params.signal,
    );
    accumulateUsage(totalUsage, response.usage);
    params.onUsage?.(response.usage);

    lastRawText = response.text;
    const extracted = extractJsonFromText(response.text);

    if (extracted.ok) {
      const parsed = params.schema.safeParse(extracted.value);
      if (parsed.success) {
        return {
          data: parsed.data,
          rawText: response.text,
          repairAttempts: attempt,
          totalUsage,
        };
      }
      lastErrors = formatZodErrors(parsed.error);
    } else {
      lastErrors = [extracted.error];
    }

    if (attempt < maxRepairAttempts) {
      messages = [
        ...messages,
        { role: 'assistant', content: response.text },
        {
          role: 'user',
          content: [
            `Your previous output failed JSON/schema validation for "${params.schemaName}".`,
            'Validation errors:',
            ...lastErrors.map((e) => `- ${e}`),
            '',
            'Return ONLY valid JSON matching the required schema (no markdown fences, no commentary).',
          ].join('\n'),
        },
      ];
    }
  }

  throw new StructuredOutputError({
    message: `Structured output validation failed for "${params.schemaName}" after ${maxRepairAttempts} repair attempt(s): ${lastErrors.join('; ')}`,
    rawText: lastRawText,
    repairAttempts: maxRepairAttempts,
    validationErrors: lastErrors,
    totalUsage,
  });
}
