import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('API error parsing', () => {
  it('preserves a management API error code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'IllegalArgumentException',
            errorMessage: 'A valid email address is required.',
            errorCode: 'invalid_request',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(register('not-an-email', 'password', 'PlayerOne')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'A valid email address is required.',
      code: 'invalid_request',
    });
  });

  it('keeps the status fallback for non-JSON errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('upstream unavailable', { status: 503 })),
    );

    await expect(register('player@example.com', 'password', 'PlayerOne')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'Request failed with status 503.',
      code: undefined,
    });
  });
});
