import { describe, expect, it } from 'vitest';
import { RateLimiterDurableObject, type RateLimitResponse } from '../src/durable-objects/rate-limiter';

class FakeStorage implements Pick<DurableObjectStorage, 'transaction'> {
  private value: unknown;
  private queue = Promise.resolve();

  transaction<T>(callback: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => callback({
      get: async <V>() => this.value as V | undefined,
      put: async <V>(_key: string, value: V) => {
        this.value = value;
      },
      delete: async () => {
        this.value = undefined;
        return true;
      },
    } as unknown as DurableObjectTransaction));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

function createLimiter(): RateLimiterDurableObject {
  const storage = new FakeStorage();
  const state = { storage } as unknown as ConstructorParameters<typeof RateLimiterDurableObject>[0];
  return new RateLimiterDurableObject(state, {});
}

async function call(
  limiter: RateLimiterDurableObject,
  input: { action: 'check' | 'record' | 'clear'; now: number; windowMs: number; limit: number; blockMs: number },
): Promise<RateLimitResponse> {
  const response = await limiter.fetch(new Request('https://rate-limiter.test/limit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
  return response.json() as Promise<RateLimitResponse>;
}

const loginWindow = { windowMs: 15 * 60 * 1000, limit: 5, blockMs: 15 * 60 * 1000 };

describe('RateLimiterDurableObject', () => {
  it('cleans up an expired window before counting a new attempt', async () => {
    const limiter = createLimiter();

    await call(limiter, { action: 'record', now: 1_000, ...loginWindow });
    const nextWindow = await call(limiter, {
      action: 'record',
      now: 1_000 + loginWindow.windowMs,
      ...loginWindow,
    });

    expect(nextWindow).toEqual({ allowed: true, blocked: false, retryAfter: 0, failedCount: 1 });
  });

  it('blocks after five failures and releases the key after the block duration', async () => {
    const limiter = createLimiter();
    const start = 10_000;

    for (let index = 0; index < 4; index += 1) {
      await call(limiter, { action: 'record', now: start + index, ...loginWindow });
    }
    const fifthFailure = await call(limiter, { action: 'record', now: start + 4, ...loginWindow });
    expect(fifthFailure).toEqual({
      allowed: true,
      blocked: true,
      retryAfter: loginWindow.blockMs,
      failedCount: 5,
    });

    await expect(call(limiter, { action: 'check', now: start + 5, ...loginWindow })).resolves.toEqual({
      allowed: false,
      blocked: true,
      retryAfter: loginWindow.blockMs - 1,
      failedCount: 5,
    });

    await expect(call(limiter, {
      action: 'check',
      now: start + 4 + loginWindow.blockMs,
      ...loginWindow,
    })).resolves.toEqual({ allowed: true, blocked: false, retryAfter: 0, failedCount: 0 });
  });

  it('serializes concurrent increments for one key without losing updates', async () => {
    const limiter = createLimiter();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => call(limiter, {
        action: 'record',
        now: 50_000 + index,
        windowMs: 60 * 60 * 1000,
        limit: 100,
        blockMs: 60 * 60 * 1000,
      })),
    );

    expect(results.map((result) => result.failedCount).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });
});
