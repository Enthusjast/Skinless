import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyWardrobeTexture,
  getWardrobe,
  renameWardrobeTexture,
  setCsrfToken,
  uploadWardrobeTexture,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('wardrobe API requests', () => {
  it('encodes filtered pagination and applies same-origin session credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            textures: [],
            total: 0,
            limit: 20,
            offset: 40,
            hasMore: false,
            quota: { used: 0, limit: 50 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await getWardrobe({ type: 'cape', limit: 20, offset: 40 });

    const [path, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(path).toBe('/api/user/wardrobe?type=cape&limit=20&offset=40');
    expect(init?.credentials).toBe('same-origin');
  });

  it('sends multipart uploads and profile-targeted apply requests', async () => {
    const fetchMock = vi.fn().mockImplementation(async (path: string) => {
      if (path === '/api/user/wardrobe') {
        return new Response(
          JSON.stringify({ texture: {}, quota: { used: 1, limit: 50 }, reused: false }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ texture: {}, profile: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await uploadWardrobeTexture('skin', new Blob(['png']), 'My skin', 'slim');
    const uploadInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const uploadBody = uploadInit.body as FormData;
    expect(uploadBody.get('type')).toBe('skin');
    expect(uploadBody.get('name')).toBe('My skin');
    expect(uploadBody.get('model')).toBe('slim');

    await renameWardrobeTexture('texture/1', 'Renamed');
    await applyWardrobeTexture('texture/1', 'profile/1');
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/user/wardrobe',
      '/api/user/wardrobe/texture%2F1',
      '/api/user/wardrobe/texture%2F1/apply',
    ]);
  });
});
