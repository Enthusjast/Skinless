import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  changePassword,
  formatApiError,
  login,
  refreshSession,
  register,
  setCsrfToken,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
  document.cookie = 'skinless_csrf=; Max-Age=0; path=/';
});

describe('management session requests', () => {
  it('sends same-origin credentials and the current CSRF token without a bearer header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    setCsrfToken('csrf-token');

    await changePassword('current-password', 'new-password');

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(init?.credentials).toBe('same-origin');
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
    expect(headers.get('Authorization')).toBeNull();
  });

  it('uses the readable CSRF cookie after the in-memory token is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    document.cookie = 'skinless_csrf=cookie-csrf; path=/';

    await changePassword('current-password', 'new-password');

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('cookie-csrf');
  });

  it('refreshes once after a 401 and retries the original request with the rotated CSRF token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errorMessage: 'expired', errorCode: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: {}, csrfToken: 'rotated-csrf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('expired-csrf');

    await expect(changePassword('current-password', 'new-password')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/user/password',
      '/api/auth/refresh',
      '/api/user/password',
    ]);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      'expired-csrf',
    );
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      'rotated-csrf',
    );
  });

  it('shares one refresh request and rotated CSRF token across concurrent 401 responses', async () => {
    let resolveRefresh!: (response: Response) => void;
    const refreshStarted = new Promise<void>((resolve) => {
      const fetchMock = vi.fn(async () => {
        if (fetchMock.mock.calls.length <= 2) {
          return new Response(
            JSON.stringify({ errorMessage: 'expired', errorCode: 'Unauthorized' }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (fetchMock.mock.calls.length === 3) {
          resolve();
          return new Promise<Response>((refreshResolve) => {
            resolveRefresh = refreshResolve;
          });
        }
        return new Response(null, { status: 204 });
      });
      vi.stubGlobal('fetch', fetchMock);
    });
    setCsrfToken('expired-csrf');

    const first = changePassword('current-password', 'new-password');
    const second = changePassword('current-password', 'new-password');
    await refreshStarted;
    resolveRefresh(
      new Response(JSON.stringify({ user: {}, csrfToken: 'rotated-csrf' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/user/password',
      '/api/user/password',
      '/api/auth/refresh',
      '/api/user/password',
      '/api/user/password',
    ]);
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      'rotated-csrf',
    );
    expect(new Headers(fetchMock.mock.calls[4]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      'rotated-csrf',
    );
  });

  it('does not retry the refresh request when refresh itself is unauthorized', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errorMessage: 'expired', errorCode: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshSession()).rejects.toMatchObject({ status: 401, code: 'Unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a second time when the retried request is still unauthorized', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errorMessage: 'expired', errorCode: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: {}, csrfToken: 'rotated-csrf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errorMessage: 'still expired', errorCode: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('expired-csrf');

    await expect(changePassword('current-password', 'new-password')).rejects.toMatchObject({
      status: 401,
      message: 'still expired',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('adaptive Turnstile login payloads', () => {
  it('includes a supplied Turnstile token without requiring one by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: {}, csrfToken: 'csrf-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await login('player@example.com', 'password', 'turnstile-token');

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'player@example.com',
      password: 'password',
      turnstileToken: 'turnstile-token',
    });
  });
});

describe('API error parsing', () => {
  it('uses the API error code for safe auth failure display', () => {
    const message = formatApiError(
      new ApiError(401, 'Bearer raw-access-token', 'Unauthorized'),
      'fallback',
    );

    expect(message).toBe('登录状态已失效，请重新登录。');
    expect(message).not.toContain('raw-access-token');
  });

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
