import { describe, expect, it } from 'vitest';
import {
  checkLoginLimit,
  clearLoginFailuresDistributed,
  recordLoginFailureDistributed,
  recordRegistrationEmailAttempt,
  recordRegistrationIpAttempt,
} from '../src/middleware/ratelimit';
import type { RateLimitResponse } from '../src/durable-objects/rate-limiter';
import { createTestRateLimiterNamespace } from './fixtures/rate-limiter';

const allowed: RateLimitResponse = { allowed: true, blocked: false, retryAfter: 0, failedCount: 0 };

class RecordingNamespace {
  public readonly names: string[] = [];
  public readonly requests: Array<{ name: string; body: Record<string, unknown> }> = [];

  idFromName(name: string): DurableObjectId {
    this.names.push(name);
    return { toString: () => name } as DurableObjectId;
  }

  get(id: DurableObjectId): DurableObjectStub {
    return {
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        this.requests.push({ name: id.toString(), body });
        return Response.json(allowed);
      },
    } as DurableObjectStub;
  }
}

describe('distributed rate limiter adapter', () => {
  it('routes login checks, failures, and clears through the Durable Object namespace', async () => {
    const namespace = new RecordingNamespace();
    const env = { RATE_LIMITER: namespace };

    await checkLoginLimit(env, '198.51.100.10');
    await recordLoginFailureDistributed(env, '198.51.100.10');
    await clearLoginFailuresDistributed(env, '198.51.100.10');

    expect(namespace.names).toEqual([
      'login:198.51.100.10',
      'login:198.51.100.10',
      'login:198.51.100.10',
    ]);
    expect(namespace.requests.map(({ body }) => body)).toEqual([
      { action: 'check', windowMs: 900000, limit: 5, blockMs: 900000 },
      { action: 'record', windowMs: 900000, limit: 5, blockMs: 900000 },
      { action: 'clear', windowMs: 900000, limit: 5, blockMs: 900000 },
    ]);
  });

  it('keeps registration IP and normalized email windows separate', async () => {
    const namespace = new RecordingNamespace();
    const env = { RATE_LIMITER: namespace };

    await recordRegistrationIpAttempt(env, '198.51.100.11');
    await recordRegistrationEmailAttempt(env, ' Player@EXAMPLE.com ');

    expect(namespace.names).toEqual([
      'registration:ip:198.51.100.11',
      'registration:email:player@example.com',
    ]);
    expect(namespace.requests.map(({ body }) => body)).toEqual([
      { action: 'record', windowMs: 3600000, limit: 5, blockMs: 3600000 },
      { action: 'record', windowMs: 3600000, limit: 3, blockMs: 3600000 },
    ]);
  });

  it('allows existing unit fixtures to run without a configured binding', async () => {
    await expect(checkLoginLimit({}, '198.51.100.12')).resolves.toEqual(allowed);
  });

  it('allows five IP attempts and three normalized-email attempts before blocking the next one', async () => {
    const env = { RATE_LIMITER: createTestRateLimiterNamespace() };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(recordRegistrationIpAttempt(env, '198.51.100.13')).resolves.toMatchObject({
        allowed: true,
        failedCount: attempt + 1,
      });
    }
    await expect(recordRegistrationIpAttempt(env, '198.51.100.13')).resolves.toMatchObject({
      allowed: false,
      blocked: true,
      failedCount: 5,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(recordRegistrationEmailAttempt(env, 'PLAYER@example.com')).resolves.toMatchObject({
        allowed: true,
        failedCount: attempt + 1,
      });
    }
    await expect(recordRegistrationEmailAttempt(env, ' player@example.com ')).resolves.toMatchObject({
      allowed: false,
      blocked: true,
      failedCount: 3,
    });
  });
});
