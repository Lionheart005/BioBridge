import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  DirectBrowserTransport,
  ExternalSearchToolForbiddenError,
  ManagedProxyTransport,
  RateLimitQueue,
  StructuredOutputError,
  TransportHttpError,
  assertNoExternalSearchTools,
  getProviderAdapter,
  listRegisteredProviders,
  requestStructuredOutput,
  type ITransportAdapter,
  type NormalizedCompletionRequest,
  type NormalizedCompletionResponse,
  type NormalizedEmbeddingResponse,
} from '@/ai';
import type { CostEstimate, ProviderId } from '@/core/schemas';

const baseCompletionReq = (
  provider: ProviderId,
  modelId = 'test-model',
): NormalizedCompletionRequest => ({
  provider,
  modelId,
  role: 'extraction',
  messages: [
    { role: 'system', content: 'You are a strict analyst.' },
    {
      role: 'user',
      content: 'Analyze this mechanism.',
      images: [{ mimeType: 'image/png', dataBase64: 'AAAA' }],
    },
  ],
  temperature: 0.2,
  maxTokens: 512,
  responseFormat: { type: 'json_object' },
});

describe('No-Web-Search Guard & Provider Adapters', () => {
  it('allows clean payloads and rejects smuggled search/tool flags recursively', () => {
    expect(() =>
      assertNoExternalSearchTools({
        model: 'gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            // User text mentioning the words must NOT trigger false positives
            content: 'Explain how web_search tools differ from local indexing.',
          },
        ],
      }),
    ).not.toThrow();

    const forbiddenPayloads: unknown[] = [
      { googleSearch: {} },
      { nested: { google_search: { dynamicRetrievalConfig: {} } } },
      { google_search_retrieval: true },
      { web_search: { enabled: true } },
      { web_search_preview: {} },
      { web_search_options: { search_context_size: 'high' } },
      { search_grounding: true },
      { grounding: {} },
      { tools: [{ type: 'function', function: { name: 'lookup' } }] },
      { tool_choice: 'auto' },
      { functions: [] },
      { function_call: 'auto' },
      { plugins: [{ id: 'web' }] },
      { model: 'openai/gpt-4o:online' },
      { modelId: 'anthropic/claude-3.7-sonnet:online' },
    ];

    for (const payload of forbiddenPayloads) {
      expect(() => assertNoExternalSearchTools(payload)).toThrow(
        ExternalSearchToolForbiddenError,
      );
    }
  });

  it('builds clean requests for all 6 providers without tools or search flags', () => {
    const providers = listRegisteredProviders();
    expect(providers).toEqual([
      'gemini',
      'openai',
      'deepseek',
      'openrouter',
      'custom',
      'anthropic',
    ]);

    for (const provider of providers) {
      const adapter = getProviderAdapter(provider);
      const built = adapter.buildCompletionHttpRequest(
        baseCompletionReq(provider),
        { apiKey: 'sk-test-123' },
      );

      expect(() => assertNoExternalSearchTools(built.body)).not.toThrow();
      expect(built.body).not.toHaveProperty('tools');
      expect(built.body).not.toHaveProperty('googleSearch');
      expect(built.body).not.toHaveProperty('web_search');

      if (provider === 'deepseek') {
        expect(built.url).toBe('https://api.deepseek.com/v1/chat/completions');
        expect(built.headers.Authorization).toBe('Bearer sk-test-123');
      }
      if (provider === 'anthropic') {
        expect(built.headers['anthropic-version']).toBe('2023-06-01');
        expect(built.headers['anthropic-dangerous-direct-browser-access']).toBe(
          'true',
        );
      }
      if (provider === 'gemini') {
        expect(built.url).toContain(':generateContent');
        expect(built.body).toHaveProperty('systemInstruction');
        expect(
          (built.body.generationConfig as Record<string, unknown>)
            .responseMimeType,
        ).toBe('application/json');
      }
    }
  });

  it('rejects :online suffix in OpenRouter/OpenAI adapter requests', () => {
    const openrouter = getProviderAdapter('openrouter');
    expect(() =>
      openrouter.buildCompletionHttpRequest(
        baseCompletionReq('openrouter', 'openai/gpt-4o:online'),
        { apiKey: 'or-key' },
      ),
    ).toThrow(ExternalSearchToolForbiddenError);
  });

  it('builds and parses embedding requests for gemini and openai', () => {
    const gemini = getProviderAdapter('gemini');
    const gReq = gemini.buildEmbeddingHttpRequest!(
      { provider: 'gemini', modelId: 'text-embedding-004', texts: ['a', 'b'] },
      { apiKey: 'gk' },
    );
    expect(gReq.url).toContain(':batchEmbedContents');
    const gRes = gemini.parseEmbeddingResponse!(
      { embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] },
      { provider: 'gemini', modelId: 'text-embedding-004', texts: ['a', 'b'] },
    );
    expect(gRes.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);

    const openai = getProviderAdapter('openai');
    const oReq = openai.buildEmbeddingHttpRequest!(
      {
        provider: 'openai',
        modelId: 'text-embedding-3-small',
        texts: ['hello'],
      },
      { apiKey: 'ok' },
    );
    expect(oReq.url).toContain('/embeddings');
    const oRes = openai.parseEmbeddingResponse!(
      { data: [{ index: 0, embedding: [1, 2] }], usage: { prompt_tokens: 3 } },
      {
        provider: 'openai',
        modelId: 'text-embedding-3-small',
        texts: ['hello'],
      },
    );
    expect(oRes.embeddings).toEqual([[1, 2]]);
    expect(oRes.usage.inputTokens).toBe(3);
  });

  it('forwards reasoningEffort across Gemini, OpenAI/DeepSeek/OpenRouter, and Anthropic adapters and parses thought tokens', () => {
    const gemini = getProviderAdapter('gemini');
    const gLow = gemini.buildCompletionHttpRequest(
      {
        ...baseCompletionReq('gemini', 'gemini-4-hydrogen'),
        reasoningEffort: 'low',
      },
      { apiKey: 'gk' },
    );
    expect(
      (gLow.body.generationConfig as Record<string, unknown>).thinkingConfig,
    ).toEqual({ thinkingLevel: 'low' });

    const gExtreme = gemini.buildCompletionHttpRequest(
      {
        ...baseCompletionReq('gemini', 'gemini-4-neon'),
        reasoningEffort: 'extreme',
      },
      { apiKey: 'gk' },
    );
    expect(
      (gExtreme.body.generationConfig as Record<string, unknown>)
        .thinkingConfig,
    ).toEqual({ thinkingLevel: 'xhigh' });

    const gParsed = gemini.parseCompletionResponse(
      {
        candidates: [
          {
            content: {
              parts: [
                { text: 'internal reasoning...', thought: true },
                { text: '{"ok":true}' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 15,
          thoughtsTokenCount: 45,
        },
      },
      baseCompletionReq('gemini', 'gemini-4-hydrogen'),
    );
    expect(gParsed.text).toBe('{"ok":true}');
    expect(gParsed.usage.inputTokens).toBe(100);
    expect(gParsed.usage.outputTokens).toBe(60);

    const openai = getProviderAdapter('openai');
    const oHigh = openai.buildCompletionHttpRequest(
      {
        ...baseCompletionReq('openai', 'gpt-6.2-sol'),
        reasoningEffort: 'high',
      },
      { apiKey: 'ok' },
    );
    expect(oHigh.body.reasoning_effort).toBe('high');

    const deepseek = getProviderAdapter('deepseek');
    const dExtreme = deepseek.buildCompletionHttpRequest(
      {
        ...baseCompletionReq('deepseek', 'deepseek-v4-pro'),
        reasoningEffort: 'extreme',
      },
      { apiKey: 'dk' },
    );
    expect(dExtreme.body.reasoning_effort).toBe('xhigh');

    const openrouter = getProviderAdapter('openrouter');
    const orMed = openrouter.buildCompletionHttpRequest(
      {
        ...baseCompletionReq('openrouter', 'google/gemini-4-hydrogen'),
        reasoningEffort: 'medium',
      },
      { apiKey: 'ork' },
    );
    expect(orMed.body.reasoning).toEqual({ effort: 'medium' });

    const orExtreme = openrouter.buildCompletionHttpRequest(
      {
        ...baseCompletionReq('openrouter', 'google/gemini-4-hydrogen'),
        reasoningEffort: 'extreme',
      },
      { apiKey: 'ork' },
    );
    expect(orExtreme.body.reasoning).toEqual({ effort: 'xhigh' });

    const anthropic = getProviderAdapter('anthropic');
    const aExtreme = anthropic.buildCompletionHttpRequest(
      {
        ...baseCompletionReq('anthropic', 'claude-opus-5-5'),
        reasoningEffort: 'extreme',
      },
      { apiKey: 'ak' },
    );
    expect(aExtreme.body.thinking).toEqual({ type: 'adaptive' });
    expect(aExtreme.body.output_config).toEqual({ effort: 'max' });
    expect(aExtreme.body).not.toHaveProperty('temperature');

    const aLow = anthropic.buildCompletionHttpRequest(
      {
        ...baseCompletionReq('anthropic', 'claude-sonnet-5-5'),
        reasoningEffort: 'low',
      },
      { apiKey: 'ak' },
    );
    expect(aLow.body.thinking).toEqual({ type: 'adaptive' });
    expect(aLow.body.output_config).toEqual({ effort: 'low' });
    expect(aLow.body).not.toHaveProperty('temperature');

    const aParsed = anthropic.parseCompletionResponse(
      {
        content: [
          { type: 'thinking', thinking: 'let me check' },
          { type: 'text', text: '{"ok":true}' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 40, output_tokens: 25 },
      },
      baseCompletionReq('anthropic', 'claude-sonnet-5-5'),
    );
    expect(aParsed.text).toBe('{"ok":true}');
  });
});

describe('DirectBrowserTransport & ManagedProxyTransport', () => {
  it('classifies 401, CORS TypeError, 429 with Retry-After, and success in testConnection', async () => {
    // 401 Auth Error
    const transport401 = new DirectBrowserTransport({
      getCredentials: () => ({ apiKey: 'bad-key' }),
      fetchFn: vi.fn(
        async () =>
          new Response('Unauthorized', { status: 401 }),
      ) as unknown as typeof fetch,
    });
    const res401 = await transport401.testConnection('openai', 'gpt-4o-mini');
    expect(res401.ok).toBe(false);
    expect(res401.errorKind).toBe('AUTH_401');

    // CORS / Network TypeError
    const transportCors = new DirectBrowserTransport({
      getCredentials: () => ({ apiKey: 'key' }),
      fetchFn: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    const resCors = await transportCors.testConnection('custom', 'llama3.1');
    expect(resCors.ok).toBe(false);
    expect(resCors.errorKind).toBe('CORS_BLOCKED');
    expect(resCors.recommendation).toContain('OLLAMA_ORIGINS');

    // 429 Rate Limit
    const transport429 = new DirectBrowserTransport({
      getCredentials: () => ({ apiKey: 'key' }),
      fetchFn: vi.fn(
        async () =>
          new Response('Too Many Requests', {
            status: 429,
            headers: { 'Retry-After': '7' },
          }),
      ) as unknown as typeof fetch,
    });
    await expect(
      transport429.sendCompletion(baseCompletionReq('openai')),
    ).rejects.toMatchObject({
      errorKind: 'RATE_LIMIT_429',
      status: 429,
      retryAfterMs: 7000,
    });
    const res429 = await transport429.testConnection('openai', 'gpt-4o-mini');
    expect(res429.ok).toBe(false);
    expect(res429.errorKind).toBe('RATE_LIMIT_429');

    // Success
    const transportOk = new DirectBrowserTransport({
      getCredentials: () => ({ apiKey: 'good-key' }),
      fetchFn: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 5, completion_tokens: 1 },
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch,
    });
    const resOk = await transportOk.testConnection('openai', 'gpt-4o-mini');
    expect(resOk.ok).toBe(true);
  });

  it('classifies HTTP 400 API_KEY_INVALID as AUTH_401 and rejects empty non-custom keys before fetch', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'INVALID_ARGUMENT',
              details: [{ reason: 'API_KEY_INVALID' }],
            },
          }),
          { status: 400 },
        ),
    ) as unknown as typeof fetch;

    const transportBadKey = new DirectBrowserTransport({
      getCredentials: () => ({ apiKey: 'AIza-invalid' }),
      fetchFn: fetchSpy,
    });
    const resInvalid = await transportBadKey.testConnection(
      'gemini',
      'gemini-4-hydrogen',
    );
    expect(resInvalid.ok).toBe(false);
    expect(resInvalid.errorKind).toBe('AUTH_401');
    expect(resInvalid.message).toContain('API_KEY_INVALID');

    const emptyFetchSpy = vi.fn() as unknown as typeof fetch;
    const transportEmpty = new DirectBrowserTransport({
      getCredentials: () => ({ apiKey: '   ' }),
      fetchFn: emptyFetchSpy,
    });
    const resEmpty = await transportEmpty.testConnection(
      'gemini',
      'gemini-4-hydrogen',
    );
    expect(resEmpty.ok).toBe(false);
    expect(resEmpty.errorKind).toBe('AUTH_401');
    expect(resEmpty.message).toContain('API-Key');
    expect(emptyFetchSpy).not.toHaveBeenCalled();
  });

  it('sends Option-B ManagedProxyTransport requests with quoteId and processes server UsageReceipts', async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/v1/billing/quote')) {
        return new Response(
          JSON.stringify({ quoteId: 'qt_999', maxChargeUsd: 0.42 }),
          { status: 200 },
        );
      }
      if (urlStr.endsWith('/v1/billing/balance')) {
        return new Response(
          JSON.stringify({ creditsUsd: 9.5, currency: 'USD' }),
          { status: 200 },
        );
      }
      if (urlStr.endsWith('/v1/ai/completions')) {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer jwt_abc');
        expect(headers['X-BioBridge-Quote-Id']).toBe('qt_999');
        const body: NormalizedCompletionResponse = {
          text: '{"ok":true}',
          provider: 'gemini',
          modelId: 'gemini-2.5-flash',
          usage: {
            inputTokens: 120,
            outputTokens: 30,
            costUsd: 0.0004,
            serverSignedReceiptId: 'rcpt_signed_1',
          },
        };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    }) as unknown as typeof fetch;

    const proxy = new ManagedProxyTransport({
      baseUrl: 'https://proxy.biobridge.example/',
      getAuthToken: () => 'jwt_abc',
      fetchFn: fetchSpy,
    });

    const dummyEstimate: CostEstimate = {
      phase1Vision: { minUsd: 0, expectedUsd: 0, maxUsd: 0, estimatedTokens: 0 },
      phase2Extract: { minUsd: 0.1, expectedUsd: 0.2, maxUsd: 0.3, estimatedTokens: 1000 },
      phase3Cross: { minUsd: 0, expectedUsd: 0, maxUsd: 0, estimatedTokens: 0 },
      phase4Critic: { minUsd: 0, expectedUsd: 0, maxUsd: 0, estimatedTokens: 0 },
      total: { minUsd: 0.1, expectedUsd: 0.2, maxUsd: 0.3, estimatedTokens: 1000 },
      cachedDocumentIds: [],
      visionPageCount: 0,
      estimatedDurationSec: { min: 5, expected: 10, max: 20 },
      usdToEurRate: 0.92,
      computedAt: '2026-11-19T00:00:00.000Z',
    };

    const quote = await proxy.requestQuote(dummyEstimate);
    expect(quote.quoteId).toBe('qt_999');

    const balance = await proxy.getAccountBalance();
    expect(balance.creditsUsd).toBe(9.5);

    const completion = await proxy.sendCompletion({
      ...baseCompletionReq('gemini', 'gemini-2.5-flash'),
      metadata: { quoteId: quote.quoteId },
    });
    expect(completion.usage.serverSignedReceiptId).toBe('rcpt_signed_1');
    expect(completion.usage.costUsd).toBe(0.0004);
  });
});

describe('requestStructuredOutput', () => {
  const TestSchema = z.object({
    mechanism: z.string().min(1),
    score: z.number().int().min(0).max(3),
  });

  it('parses JSON wrapped in markdown code fences', async () => {
    const mockTransport: ITransportAdapter = {
      mode: 'direct-byok',
      sendCompletion: vi.fn(async (): Promise<NormalizedCompletionResponse> => ({
        text: 'Here is the result:\n```json\n{"mechanism":"Turgor","score":3}\n```',
        provider: 'gemini',
        modelId: 'gemini-2.5-flash',
        usage: { inputTokens: 50, outputTokens: 20 },
      })),
      sendEmbedding: vi.fn(async (): Promise<NormalizedEmbeddingResponse> => ({
        embeddings: [],
        provider: 'gemini',
        modelId: 'text-embedding-004',
        usage: { inputTokens: 0, outputTokens: 0 },
      })),
    };

    const result = await requestStructuredOutput({
      transport: mockTransport,
      request: baseCompletionReq('gemini'),
      schema: TestSchema,
      schemaName: 'TestMechanism',
    });

    expect(result.data).toEqual({ mechanism: 'Turgor', score: 3 });
    expect(result.repairAttempts).toBe(0);
    expect(result.totalUsage.inputTokens).toBe(50);
  });

  it('automatically performs JSON-repair retry on invalid output and accumulates usage', async () => {
    const sendCompletion = vi
      .fn<ITransportAdapter['sendCompletion']>()
      .mockResolvedValueOnce({
        text: '{"mechanism":"Turgor","score":99}', // fails max(3)
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        usage: { inputTokens: 100, outputTokens: 25 },
      })
      .mockResolvedValueOnce({
        text: '{"mechanism":"Turgor","score":2}',
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        usage: { inputTokens: 140, outputTokens: 20 },
      });

    const mockTransport: ITransportAdapter = {
      mode: 'direct-byok',
      sendCompletion,
      sendEmbedding: vi.fn(),
    };

    const onUsage = vi.fn();
    const result = await requestStructuredOutput({
      transport: mockTransport,
      request: baseCompletionReq('openai'),
      schema: TestSchema,
      schemaName: 'TestMechanism',
      maxRepairAttempts: 2,
      onUsage,
    });

    expect(result.data).toEqual({ mechanism: 'Turgor', score: 2 });
    expect(result.repairAttempts).toBe(1);
    expect(result.totalUsage).toEqual({ inputTokens: 240, outputTokens: 45 });
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(sendCompletion).toHaveBeenCalledTimes(2);
    const secondCallReq = sendCompletion.mock.calls[1][0];
    expect(secondCallReq.messages.at(-1)?.content).toContain('score');
  });

  it('throws StructuredOutputError when repair attempts are exhausted', async () => {
    const mockTransport: ITransportAdapter = {
      mode: 'direct-byok',
      sendCompletion: vi.fn(async (): Promise<NormalizedCompletionResponse> => ({
        text: 'not valid json at all',
        provider: 'gemini',
        modelId: 'gemini-2.5-flash',
        usage: { inputTokens: 10, outputTokens: 5 },
      })),
      sendEmbedding: vi.fn(),
    };

    await expect(
      requestStructuredOutput({
        transport: mockTransport,
        request: baseCompletionReq('gemini'),
        schema: TestSchema,
        schemaName: 'TestMechanism',
        maxRepairAttempts: 1,
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });
});

describe('RateLimitQueue', () => {
  it('enforces concurrency limits and retries 429 with backoff using injected sleep', async () => {
    const sleepCalls: number[] = [];
    let currentTime = 0;
    const sleep = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
      currentTime += ms;
    });

    const queue = new RateLimitQueue({
      concurrency: 2,
      requestsPerMinute: 120,
      maxRetries: 2,
      baseBackoffMs: 500,
      sleep,
      now: () => currentTime,
    });

    let active = 0;
    let maxActive = 0;
    let retryCounter = 0;

    const tasks = [0, 1, 2, 3].map((idx) =>
      queue.enqueue(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        try {
          if (idx === 0 && retryCounter === 0) {
            retryCounter += 1;
            throw new TransportHttpError({
              message: 'Rate limit',
              errorKind: 'RATE_LIMIT_429',
              status: 429,
              retryAfterMs: 1200,
            });
          }
          return idx * 10;
        } finally {
          active -= 1;
        }
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 10, 20, 30]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(sleepCalls).toContain(1200);
  });

  it('supports pause, resume, and abort', async () => {
    const queue = new RateLimitQueue({
      concurrency: 1,
      requestsPerMinute: 600,
      sleep: async () => undefined,
    });

    queue.pause();
    expect(queue.isPaused()).toBe(true);

    let executed = false;
    const pendingPromise = queue.enqueue(async () => {
      executed = true;
      return 'done';
    });

    await Promise.resolve();
    expect(executed).toBe(false);

    queue.resume();
    expect(queue.isPaused()).toBe(false);
    expect(await pendingPromise).toBe('done');
    expect(executed).toBe(true);

    queue.pause();
    const abortedPromise = queue.enqueue(async () => 'never');
    queue.abort('User cancelled');
    expect(queue.isAborted()).toBe(true);
    await expect(abortedPromise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
