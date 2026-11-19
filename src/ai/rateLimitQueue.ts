import { TransportHttpError } from '@/ai/types';

export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface RateLimitQueueOptions {
  concurrency?: number;
  requestsPerMinute?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  sleep?: SleepFn;
  now?: () => number;
}

export interface RateLimitQueueStats {
  pending: number;
  active: number;
  paused: boolean;
  aborted: boolean;
}

interface QueueItem<T> {
  fn: (signal: AbortSignal) => Promise<T>;
  externalSignal?: AbortSignal;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createAbortError(message = 'Queue aborted'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function extractRetryInfo(err: unknown): {
  retryable: boolean;
  retryAfterMs?: number;
} {
  if (isAbortError(err)) {
    return { retryable: false };
  }
  if (err instanceof TransportHttpError) {
    if (err.errorKind === 'RATE_LIMIT_429' || err.status === 429) {
      return { retryable: true, retryAfterMs: err.retryAfterMs };
    }
    if (err.status !== undefined && err.status >= 500 && err.status < 600) {
      return { retryable: true };
    }
    return { retryable: false };
  }
  if (err && typeof err === 'object') {
    const maybe = err as { status?: unknown; retryAfterMs?: unknown };
    if (maybe.status === 429) {
      return {
        retryable: true,
        retryAfterMs:
          typeof maybe.retryAfterMs === 'number' ? maybe.retryAfterMs : undefined,
      };
    }
    if (
      typeof maybe.status === 'number' &&
      maybe.status >= 500 &&
      maybe.status < 600
    ) {
      return { retryable: true };
    }
  }
  return { retryable: false };
}

export class RateLimitQueue {
  private readonly concurrency: number;
  private readonly requestsPerMinute: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly sleepFn: SleepFn;
  private readonly nowFn: () => number;

  private readonly queue: Array<QueueItem<unknown>> = [];
  private activeCount = 0;
  private paused = false;
  private aborted = false;
  private abortController = new AbortController();
  private pauseWaiters: Array<() => void> = [];

  private tokens: number;
  private lastRefillMs: number;
  private tokenLock: Promise<void> = Promise.resolve();

  constructor(options: RateLimitQueueOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 3);
    this.requestsPerMinute = Math.max(1, options.requestsPerMinute ?? 60);
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.baseBackoffMs = Math.max(1, options.baseBackoffMs ?? 1000);
    this.maxBackoffMs = Math.max(
      this.baseBackoffMs,
      options.maxBackoffMs ?? 30_000,
    );
    this.sleepFn = options.sleep ?? defaultSleep;
    this.nowFn = options.now ?? (() => Date.now());

    this.tokens = this.requestsPerMinute;
    this.lastRefillMs = this.nowFn();
  }

  enqueue<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.aborted) {
      return Promise.reject(createAbortError('RateLimitQueue has been aborted.'));
    }
    if (signal?.aborted) {
      return Promise.reject(createAbortError('Task signal already aborted.'));
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn: fn as (signal: AbortSignal) => Promise<unknown>,
        externalSignal: signal,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    const waiters = this.pauseWaiters.splice(0);
    for (const wake of waiters) {
      wake();
    }
    this.pump();
  }

  abort(reason = 'RateLimitQueue aborted'): void {
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    this.paused = false;
    this.abortController.abort(reason);

    const waiters = this.pauseWaiters.splice(0);
    for (const wake of waiters) {
      wake();
    }

    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.reject(createAbortError(reason));
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  isAborted(): boolean {
    return this.aborted;
  }

  getStats(): RateLimitQueueStats {
    return {
      pending: this.queue.length,
      active: this.activeCount,
      paused: this.paused,
      aborted: this.aborted,
    };
  }

  private async waitIfPaused(signal: AbortSignal): Promise<void> {
    while (this.paused && !this.aborted && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.pauseWaiters.push(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
      });
    }
    if (this.aborted || signal.aborted) {
      throw createAbortError();
    }
  }

  private async acquireRateLimitToken(signal: AbortSignal): Promise<void> {
    const run = async (): Promise<void> => {
      while (true) {
        await this.waitIfPaused(signal);
        const now = this.nowFn();
        const elapsedMs = Math.max(0, now - this.lastRefillMs);
        if (elapsedMs > 0) {
          const refill = (elapsedMs / 60_000) * this.requestsPerMinute;
          this.tokens = Math.min(this.requestsPerMinute, this.tokens + refill);
          this.lastRefillMs = now;
        }

        if (this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }

        const waitMs = Math.ceil(
          ((1 - this.tokens) / this.requestsPerMinute) * 60_000,
        );
        await this.sleepFn(Math.max(1, waitMs), signal);
      }
    };

    const next = this.tokenLock.then(run, run);
    this.tokenLock = next.catch(() => undefined);
    return next;
  }

  private pump(): void {
    if (this.paused || this.aborted) {
      return;
    }

    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      if (item.externalSignal?.aborted) {
        item.reject(createAbortError('Task signal aborted before start.'));
        continue;
      }

      this.activeCount += 1;
      void this.runItem(item).finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
    }
  }

  private combineSignals(external?: AbortSignal): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    if (!external) {
      return { signal: this.abortController.signal, cleanup: () => undefined };
    }
    const combined = new AbortController();
    const abortFromInternal = () => combined.abort(this.abortController.signal.reason);
    const abortFromExternal = () => combined.abort(external.reason);

    if (this.abortController.signal.aborted) {
      abortFromInternal();
    } else if (external.aborted) {
      abortFromExternal();
    } else {
      this.abortController.signal.addEventListener('abort', abortFromInternal, {
        once: true,
      });
      external.addEventListener('abort', abortFromExternal, { once: true });
    }

    return {
      signal: combined.signal,
      cleanup: () => {
        this.abortController.signal.removeEventListener(
          'abort',
          abortFromInternal,
        );
        external.removeEventListener('abort', abortFromExternal);
      },
    };
  }

  private async runItem(item: QueueItem<unknown>): Promise<void> {
    const { signal, cleanup } = this.combineSignals(item.externalSignal);
    try {
      for (let attempt = 0; ; attempt += 1) {
        await this.waitIfPaused(signal);
        await this.acquireRateLimitToken(signal);

        try {
          const result = await item.fn(signal);
          item.resolve(result);
          return;
        } catch (err) {
          const retryInfo = extractRetryInfo(err);
          if (!retryInfo.retryable || attempt >= this.maxRetries) {
            throw err;
          }
          const expDelay = Math.min(
            this.maxBackoffMs,
            this.baseBackoffMs * Math.pow(2, attempt),
          );
          const delayMs =
            retryInfo.retryAfterMs !== undefined
              ? Math.max(expDelay, retryInfo.retryAfterMs)
              : expDelay;
          await this.sleepFn(delayMs, signal);
        }
      }
    } catch (err) {
      item.reject(err);
    } finally {
      cleanup();
    }
  }
}
