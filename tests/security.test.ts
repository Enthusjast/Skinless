import { describe, expect, it } from 'vitest';
import worker, { app } from '../src/index';

describe('security and operational safeguards', () => {
  it('adds stable codes to management errors without changing Yggdrasil errors', async () => {
    const management = await app.request('/api/auth/register/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, { CORS_ORIGIN: '*', DB: {}, BUCKET: {} });

    expect(management.status).toBe(400);
    await expect(management.json()).resolves.toEqual({
      error: 'IllegalArgumentException',
      errorMessage: 'email, password and name are required.',
      errorCode: 'invalid_request',
    });

    const yggdrasil = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'player@example.com' }),
    }, { CORS_ORIGIN: '*', DB: {}, BUCKET: {} });

    expect(yggdrasil.status).toBe(400);
    await expect(yggdrasil.json()).resolves.toEqual({
      error: 'ForbiddenOperationException',
      errorMessage: 'username and password are required.',
    });

    const unauthorized = await app.request('/api/user/profile', {}, { CORS_ORIGIN: '*', DB: {}, BUCKET: {} });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: 'Unauthorized',
      errorMessage: 'A Bearer access token is required.',
      errorCode: 'unauthorized',
    });

    const managementNotFound = await app.request('/api/not-found', {}, { CORS_ORIGIN: '*', DB: {}, BUCKET: {} });
    expect(managementNotFound.status).toBe(404);
    await expect(managementNotFound.json()).resolves.toEqual({
      error: 'NotFound',
      errorMessage: 'Resource not found.',
      errorCode: 'not_found',
    });

    const yggdrasilNotFound = await app.request('/api/yggdrasil/not-found', {}, { CORS_ORIGIN: '*', DB: {}, BUCKET: {} });
    expect(yggdrasilNotFound.status).toBe(404);
    await expect(yggdrasilNotFound.json()).resolves.toEqual({
      error: 'NotFound',
      errorMessage: 'Resource not found.',
    });
  });

  it('answers CORS preflight requests without requiring authentication', async () => {
    const response = await app.request('/api/user/profile', {
      method: 'OPTIONS',
      headers: { Origin: 'https://pages.example.com', 'Access-Control-Request-Method': 'GET' },
    }, { CORS_ORIGIN: '*', DB: {}, BUCKET: {} });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('DELETE');
    expect(response.headers.get('access-control-allow-methods')).toContain('PATCH');
  });

  it('echoes only configured origins and rejects disallowed preflight requests', async () => {
    const env = {
      CORS_ORIGIN: 'https://pages.example.com, https://admin.example.com',
      DB: {},
      BUCKET: {},
    };

    const sameOrigin = await app.request('/api/yggdrasil/', {}, env);
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.headers.get('access-control-allow-origin')).toBeNull();

    const allowed = await app.request('/api/yggdrasil/', {
      headers: { Origin: 'https://pages.example.com' },
    }, env);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://pages.example.com');
    expect(allowed.headers.get('vary')).toContain('Origin');

    const allowedPreflight = await app.request('/api/user/profile', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://pages.example.com',
        'Access-Control-Request-Method': 'PATCH',
      },
    }, env);
    expect(allowedPreflight.status).toBe(204);
    expect(allowedPreflight.headers.get('access-control-allow-origin')).toBe('https://pages.example.com');
    expect(allowedPreflight.headers.get('access-control-allow-methods')).toContain('PATCH');

    const rejectedPreflight = await app.request('/api/user/profile', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://malicious.example.com',
        'Access-Control-Request-Method': 'PATCH',
      },
    }, env);
    expect(rejectedPreflight.status).toBe(403);
    expect(rejectedPreflight.headers.get('access-control-allow-origin')).toBeNull();

    const rejected = await app.request('/api/yggdrasil/', {
      headers: { Origin: 'https://malicious.example.com' },
    }, env);
    expect(rejected.status).toBe(200);
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('adds baseline security headers and preserves or generates request IDs', async () => {
    const supplied = await app.request('/api/yggdrasil/', {
      headers: { 'X-Request-Id': 'task-five-request' },
    }, { CORS_ORIGIN: '*', DB: {}, BUCKET: {} });

    expect(supplied.headers.get('x-content-type-options')).toBe('nosniff');
    expect(supplied.headers.get('referrer-policy')).toBe('no-referrer');
    expect(supplied.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(supplied.headers.get('x-frame-options')).toBe('DENY');
    expect(supplied.headers.get('x-request-id')).toBe('task-five-request');

    const generated = await app.request('/api/yggdrasil/', {}, { CORS_ORIGIN: '*', DB: {}, BUCKET: {} });
    expect(generated.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('preserves route headers when securing a raw texture response', async () => {
    const response = await app.request('/textures/' + 'a'.repeat(64), {
      headers: { Origin: 'https://pages.example.com' },
    }, {
      CORS_ORIGIN: 'https://pages.example.com',
      DB: {},
      BUCKET: {
        get: async () => ({
          body: new Response(new Uint8Array([137, 80, 78, 71])).body,
          httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=60' },
          httpEtag: 'fixture-etag',
        }),
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('etag')).toBe('fixture-etag');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://pages.example.com');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('runs the scheduled expired-token cleanup query', async () => {
    let deletedBefore = 0;
    const cleanupQueries: string[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          cleanupQueries.push(sql);
          return {
            bind(...values: number[]) {
              deletedBefore = values[0] ?? 0;
              return {
                all: async () => ({ results: [] }),
                run: async () => ({ success: true }),
              };
            },
          };
        },
      },
      BUCKET: { delete: async () => undefined },
    };

    await worker.scheduled?.({} as ScheduledController, env as never, {} as ExecutionContext);
    expect(deletedBefore).toBeGreaterThan(0);
    expect(cleanupQueries.slice(0, 2)).toEqual([
      'DELETE FROM tokens WHERE expires_at < ?',
      'DELETE FROM server_sessions WHERE expires_at < ?',
    ]);
    expect(cleanupQueries[2]).toContain('FROM texture_cleanup');
  });
});
