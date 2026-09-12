import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAccountDeletion, restoreAccount, setCsrfToken } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('account deletion API', () => {
  it('uses the CSRF-protected self-deletion contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ challengeId: 'restore-1', deletionAt: 8, status: 'pending_deletion' }),
            { status: 202, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    );
    setCsrfToken('csrf-token');

    await expect(requestAccountDeletion('current-password', 'DELETE')).resolves.toMatchObject({
      challengeId: 'restore-1',
    });

    const [path, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(path).toBe('/api/user/deletion');
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-token');
    expect(JSON.parse(String(init?.body))).toEqual({
      currentPassword: 'current-password',
      confirmation: 'DELETE',
    });
  });

  it('sends email and restore code through the public recovery contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(restoreAccount(' PLAYER@EXAMPLE.COM ', '731042')).resolves.toBeUndefined();

    const [path, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(path).toBe('/api/auth/account/restore');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: ' PLAYER@EXAMPLE.COM ',
      code: '731042',
    });
  });
});
