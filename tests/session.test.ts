import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { ProfileRecord } from '../src/types';
import { YGGDRASIL_PRIVATE_KEY_PEM, YGGDRASIL_PUBLIC_KEY_PEM } from './fixtures/yggdrasil-keys';

class ProfileD1 {
  public constructor(private readonly profile: ProfileRecord) {}

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind: (...values: unknown[]) => ({
        first: async <T>() => {
          if (normalized.includes('FROM server_sessions')) {
            return (values[0] === 'server-id' && values[1] === this.profile.name ? { ...this.profile } : null) as T | null;
          }
          if (normalized.includes('WHERE name = ?')) return (this.profile.name.toLowerCase() === String(values[0]).toLowerCase() ? { ...this.profile } : null) as T | null;
          if (normalized.includes('WHERE id = ?')) return (this.profile.id === values[0] ? { ...this.profile } : null) as T | null;
          return null as T | null;
        },
      }),
    };
  }
}

class TextureBucket {
  public constructor(private readonly content: Uint8Array) {}

  async get(key: string) {
    if (!key.startsWith('a'.repeat(64))) return null;
    return {
      body: new Response(this.content as unknown as BodyInit).body,
      httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
      httpEtag: 'fixture-etag',
    } as R2ObjectBody;
  }
}

const profile: ProfileRecord = {
  id: '0123456789abcdef0123456789abcdef',
  user_id: 'user-1',
  name: 'PlayerOne',
  skin_hash: 'a'.repeat(64),
  cape_hash: 'b'.repeat(64),
  skin_model: 'slim',
};

const env = {
  DB: new ProfileD1(profile) as unknown as D1Database,
  BUCKET: new TextureBucket(new Uint8Array([137, 80, 78, 71])) as unknown as R2Bucket,
  API_BASE_URL: 'https://skin.example.com',
  SKIN_DOMAIN: 'skin.example.com',
  YGGDRASIL_PRIVATE_KEY_PEM,
  YGGDRASIL_PUBLIC_KEY_PEM,
};

describe('Yggdrasil session and texture API', () => {
  it('returns a profile with a decodable textures property', async () => {
    const response = await app.request('/api/yggdrasil/sessionserver/session/minecraft/profile/0123456789abcdef0123456789abcdef', {}, env);

    expect(response.status).toBe(200);
    const body = await response.json() as { id: string; name: string; properties: Array<{ name: string; value: string; signature?: string }> };
    expect(body).toMatchObject({ id: profile.id, name: profile.name });
    const decoded = JSON.parse(atob(body.properties[0].value)) as { profileId: string; textures: { SKIN: { url: string; metadata: { model: string } }; CAPE: { url: string } } };
    expect(decoded).toMatchObject({
      profileId: profile.id,
      textures: {
        SKIN: { url: 'https://skin.example.com/textures/' + profile.skin_hash, metadata: { model: 'slim' } },
        CAPE: { url: 'https://skin.example.com/textures/' + profile.cape_hash },
      },
    });
    const publicKeyBytes = Uint8Array.from(atob(
      YGGDRASIL_PUBLIC_KEY_PEM.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''),
    ), (character) => character.charCodeAt(0));
    const publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
      false,
      ['verify'],
    );
    const signature = Uint8Array.from(atob(body.properties[0].signature!), (character) => character.charCodeAt(0));
    await expect(crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      new TextEncoder().encode(body.properties[0].value),
    )).resolves.toBe(true);
  });

  it('returns 204 when hasJoined cannot find the player', async () => {
    const response = await app.request('/sessionserver/session/minecraft/hasJoined?username=Unknown&serverId=server-id', {}, env);
    expect(response.status).toBe(204);
  });

  it('looks up one profile case-insensitively and returns 204 when it is absent', async () => {
    const found = await app.request(
      '/api/yggdrasil/api/profiles/minecraft/playerone',
      {},
      env,
    );
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual({ id: profile.id, name: profile.name });

    const missing = await app.request('/profiles/minecraft/Unknown', {}, env);
    expect(missing.status).toBe(204);
  });

  it('returns only found profiles for a batch lookup and preserves empty results', async () => {
    const found = await app.request('/api/yggdrasil/api/profiles/minecraft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['PLAYERONE', 'Unknown']),
    }, env);
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual([{ id: profile.id, name: profile.name }]);

    const empty = await app.request('/api/profiles/minecraft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    }, env);
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual([]);
  });

  it('caches successful hasJoined responses at the edge for one minute', async () => {
    const response = await app.request('/sessionserver/session/minecraft/hasJoined?username=PlayerOne&serverId=server-id', {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('returns private R2 content with immutable caching', async () => {
    const response = await app.request('/textures/' + profile.skin_hash, {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it('returns 304 for a matching texture ETag without a response body', async () => {
    const response = await app.request(`/textures/${profile.skin_hash}`, {
      headers: { 'If-None-Match': 'fixture-etag' },
    }, env);

    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('fixture-etag');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(await response.text()).toBe('');
  });

  it('does not silently omit texture signatures outside explicit local unsigned mode', async () => {
    const response = await app.request(
      '/sessionserver/session/minecraft/profile/0123456789abcdef0123456789abcdef',
      {},
      {
        ...env,
        ENVIRONMENT: 'production',
        YGGDRASIL_PRIVATE_KEY_PEM: undefined,
        YGGDRASIL_PUBLIC_KEY_PEM: undefined,
        YGGDRASIL_ALLOW_UNSIGNED_TEXTURES: 'true',
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'InternalServerError',
      errorMessage: 'Internal server error.',
    });
  });

  it('omits texture signatures only for explicit local unsigned mode', async () => {
    const response = await app.request(
      '/sessionserver/session/minecraft/profile/0123456789abcdef0123456789abcdef',
      {},
      {
        ...env,
        ENVIRONMENT: 'development',
        YGGDRASIL_PRIVATE_KEY_PEM: undefined,
        YGGDRASIL_PUBLIC_KEY_PEM: undefined,
        YGGDRASIL_ALLOW_UNSIGNED_TEXTURES: 'true',
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { properties: Array<Record<string, unknown>> };
    expect(body.properties[0]).not.toHaveProperty('signature');
  });

  it('normalizes uppercase texture hashes and optional PNG suffixes', async () => {
    const response = await app.request('/textures/' + profile.skin_hash!.toUpperCase() + '.PNG', {}, env);
    expect(response.status).toBe(200);
  });
});
