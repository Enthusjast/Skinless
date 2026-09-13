import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublicProfileById, getPublicProfileByName } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('public profile API requests', () => {
  it('loads a UUID profile without a management-session request', async () => {
    const profile = {
      id: 'a'.repeat(32),
      name: 'PlayerOne',
      model: 'classic' as const,
      skin: { url: '/textures/skin-hash' },
      cape: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPublicProfileById(profile.id)).resolves.toEqual(profile);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/profiles/${profile.id}`,
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBeUndefined();
  });

  it('maps the name endpoint 204 response to an explicit missing profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(getPublicProfileByName('MissingPlayer')).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      '/api/public/profiles/name/MissingPlayer',
      expect.anything(),
    );
  });
});
