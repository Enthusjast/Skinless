import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCsrfToken } from '../api';
import { useAuthStore } from './auth';

const user = {
  id: 'user-1',
  email: 'player@example.com',
  role: 'user' as const,
  createdAt: 1,
  updatedAt: 1,
  profile: {
    id: 'profile-1',
    name: 'PlayerOne',
    skinHash: null,
    capeHash: null,
    skinModel: 'classic' as const,
  },
};

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  clearCsrfToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('cookie-backed auth store', () => {
  it('clears legacy token storage and initializes from the cookie profile endpoint', async () => {
    localStorage.setItem(
      'skinless.session',
      JSON.stringify({ token: 'legacy-access-token', clientToken: 'legacy-client-token' }),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const auth = useAuthStore();
    await auth.initialize();

    expect(localStorage.getItem('skinless.session')).toBeNull();
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.user).toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/user/profile',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('logs out through the cookie endpoint and clears local auth state', async () => {
    localStorage.setItem('skinless.session', 'legacy-session');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user, csrfToken: 'csrf-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const auth = useAuthStore();
    await auth.login('player@example.com', 'password');
    await auth.logout();

    expect(auth.user).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem('skinless.session')).toBeNull();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/auth/login',
      '/api/auth/logout',
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ credentials: 'same-origin', method: 'POST' }),
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      'csrf-token',
    );
  });

  it('clears local auth state when the network logout request fails', async () => {
    localStorage.setItem('skinless.session', 'legacy-session');
    const fetchMock = vi.fn().mockRejectedValue(new Error('network offline'));
    vi.stubGlobal('fetch', fetchMock);

    const auth = useAuthStore();
    auth.user = user;
    await expect(auth.logout()).resolves.toBeUndefined();

    expect(auth.user).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem('skinless.session')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ credentials: 'same-origin', method: 'POST' }),
    );
  });

  it('refreshes once when the initial cookie profile request is unauthorized', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errorMessage: 'expired', errorCode: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user, csrfToken: 'refreshed-csrf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const auth = useAuthStore();
    await auth.initialize();

    expect(auth.user).toEqual(user);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/user/profile',
      '/api/auth/refresh',
      '/api/user/profile',
    ]);
  });

  it('switches the default profile and keeps the active user profile in sync', async () => {
    const secondProfile = {
      id: 'profile-2',
      name: 'SecondPlayer',
      skinHash: 'second-skin',
      capeHash: null,
      skinModel: 'slim' as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { ...user, profile: secondProfile },
          profiles: [user.profile, secondProfile],
          defaultProfileId: secondProfile.id,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const auth = useAuthStore();
    auth.user = user;
    auth.profiles = [user.profile, secondProfile];
    auth.defaultProfileId = user.profile.id;
    await auth.setDefaultProfile(secondProfile.id);

    expect(auth.profile).toEqual(secondProfile);
    expect(auth.defaultProfileId).toBe(secondProfile.id);
    expect(auth.profiles).toEqual([user.profile, secondProfile]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/user/profiles/profile-2/default');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-CSRF-Token')).toBeNull();
  });
});
