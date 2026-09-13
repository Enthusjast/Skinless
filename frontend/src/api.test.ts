import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  changePassword,
  createAdminInvite,
  completeEmailChange,
  formatApiError,
  getAdminInvites,
  getAdminAuditLogs,
  getAdminSettings,
  login,
  deleteAdminUser,
  resendEmailChange,
  resendPasswordReset,
  refreshSession,
  register,
  revokeAdminInvite,
  revokeAdminUserSessions,
  setCsrfToken,
  startEmailChange,
  startPasswordReset,
  updateAdminUserStatus,
  updateAdminSettings,
  verifyPasswordReset,
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

describe('admin registration settings and invite requests', () => {
  it('uses management requests and keeps the creation code separate from list payloads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            settings: {
              registrationMode: 'open',
              maxProfilesPerUser: 5,
              maxTexturesPerUser: 50,
              enforceJoinIp: false,
              createdAt: 1,
              updatedAt: 1,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            settings: {
              registrationMode: 'invite',
              maxProfilesPerUser: 4,
              maxTexturesPerUser: 40,
              enforceJoinIp: true,
              createdAt: 1,
              updatedAt: 2,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ invites: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            invite: {
              id: 'invite-1',
              code: 'secret-code',
              codePrefix: 'secret-c',
              useCount: 0,
              useLimit: 1,
              expiresAt: null,
              note: '',
              revokedAt: null,
              createdAt: 1,
              updatedAt: 1,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            invite: {
              id: 'invite-1',
              codePrefix: 'secret-c',
              useCount: 0,
              useLimit: 1,
              expiresAt: null,
              note: '',
              revokedAt: 2,
              createdAt: 1,
              updatedAt: 2,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAdminSettings()).resolves.toMatchObject({
      settings: { registrationMode: 'open' },
    });
    await updateAdminSettings({
      registrationMode: 'invite',
      maxProfilesPerUser: 4,
      maxTexturesPerUser: 40,
      enforceJoinIp: true,
    });
    await expect(getAdminInvites()).resolves.toEqual({ invites: [] });
    await expect(
      createAdminInvite({ useLimit: 1, expiresAt: null, note: '' }),
    ).resolves.toMatchObject({
      invite: { code: 'secret-code' },
    });
    await revokeAdminInvite('invite-1');

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/admin/settings',
      '/api/admin/settings',
      '/api/admin/invites',
      '/api/admin/invites',
      '/api/admin/invites/invite-1/revoke',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      registrationMode: 'invite',
      maxProfilesPerUser: 4,
      maxTexturesPerUser: 40,
      enforceJoinIp: true,
    });
  });
});

describe('admin account control requests', () => {
  it('sends status, session-revocation, and deletion confirmations through management requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'user-1', status: 'disabled' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf-token');

    await updateAdminUserStatus('user-1', 'disabled', 'DISABLE');
    await revokeAdminUserSessions('user-1', 'REVOKE');
    await deleteAdminUser('user-1', 'DELETE');

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/admin/users/user-1/status',
      '/api/admin/users/user-1/sessions',
      '/api/admin/users/user-1',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      status: 'disabled',
      confirmation: 'DISABLE',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      confirmation: 'REVOKE',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      confirmation: 'DELETE',
    });
  });
});

describe('admin audit log requests', () => {
  it('encodes read-only audit pagination and filters through the management API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ logs: [], limit: 25, offset: 0, hasMore: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getAdminAuditLogs({
        limit: 25,
        offset: 0,
        action: 'admin.user.status.update',
        actorUserId: 'admin-1',
        targetUserId: 'user-1',
        from: '2026-09-01',
        to: '2026-09-13',
      }),
    ).resolves.toMatchObject({ logs: [], hasMore: false });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/admin/audit-logs?limit=25&offset=0&action=admin.user.status.update&actorUserId=admin-1&targetUserId=user-1&from=2026-09-01&to=2026-09-13',
    );
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

  it('sends repeated registration details through the start endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ challengeId: 'challenge-1', expiresAt: 1, resendAfter: 2 }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      register('player@example.com', 'updated-password', 'UpdatedPlayer'),
    ).resolves.toEqual({
      challengeId: 'challenge-1',
      expiresAt: 1,
      resendAfter: 2,
    });

    const [path, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(path).toBe('/api/auth/register/start');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'player@example.com',
      password: 'updated-password',
      name: 'UpdatedPlayer',
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

  it('routes recovery and email-change requests through their public contracts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: 'If an account exists for this email, a password reset code has been sent.',
            challengeId: 'reset-1',
            expiresAt: 1,
            resendAfter: 2,
          }),
          {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: 'If an account exists for this email, a password reset code has been sent.',
            challengeId: 'reset-1',
            expiresAt: 3,
            resendAfter: 4,
          }),
          {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challengeId: 'email-1',
            email: 'new@example.com',
            expiresAt: 5,
            resendAfter: 6,
          }),
          {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf-token');

    await startPasswordReset(' PLAYER@EXAMPLE.COM ', 'reset-token');
    await resendPasswordReset('reset-1', 'reset-resend-token');
    await verifyPasswordReset('reset-1', '731042', 'new-password');
    await startEmailChange('current-password', 'new@example.com', 'email-token');
    await resendEmailChange('email-1', 'email-resend-token');
    await completeEmailChange('email-1', '042731', 'current-password');

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/auth/password/reset/start',
      '/api/auth/password/reset/resend',
      '/api/auth/password/reset/verify',
      '/api/user/email/change/start',
      '/api/user/email/change/resend',
      '/api/user/email',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: ' PLAYER@EXAMPLE.COM ',
      turnstileToken: 'reset-token',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      challengeId: 'reset-1',
      turnstileToken: 'reset-resend-token',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      challengeId: 'reset-1',
      code: '731042',
      newPassword: 'new-password',
    });
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      'csrf-token',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      currentPassword: 'current-password',
      newEmail: 'new@example.com',
      turnstileToken: 'email-token',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({
      challengeId: 'email-1',
      turnstileToken: 'email-resend-token',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({
      challengeId: 'email-1',
      code: '042731',
      currentPassword: 'current-password',
    });
  });
});
