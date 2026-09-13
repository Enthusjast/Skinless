import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { registerVerifiedAccount } from './verified-registration-fixture';

async function jsonRequest(path: string, body: unknown, headers: HeadersInit = {}): Promise<Response> {
  return SELF.fetch(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('complete Yggdrasil profile services on real D1/R2', () => {
  it('serves public-key discovery and common single/batch profile lookups', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
    const account = await registerVerifiedAccount(
      `profile-services-${suffix}@example.com`,
      'correct-password',
      `Lookup${suffix}`,
    );

    const metadata = await SELF.fetch('https://worker.test/api/yggdrasil/');
    expect(metadata.status).toBe(200);
    const metadataBody = await metadata.json() as { signaturePublickey?: string };
    expect(metadataBody.signaturePublickey).toContain('BEGIN PUBLIC KEY');

    const publicKeys = await SELF.fetch('https://worker.test/api/publickeys');
    expect(publicKeys.status).toBe(200);
    await expect(publicKeys.json()).resolves.toEqual({ yggdrasil: metadataBody.signaturePublickey });

    const single = await SELF.fetch(
      `https://worker.test/api/yggdrasil/api/profiles/minecraft/${account.profile.name.toLowerCase()}`,
    );
    expect(single.status).toBe(200);
    await expect(single.json()).resolves.toEqual({ id: account.profile.id, name: account.profile.name });

    const batch = await jsonRequest('/api/yggdrasil/api/profiles/minecraft', [
      account.profile.name.toUpperCase(),
      `Missing${suffix}`,
    ]);
    expect(batch.status).toBe(200);
    await expect(batch.json()).resolves.toEqual([{ id: account.profile.id, name: account.profile.name }]);

    const empty = await jsonRequest('/api/profiles/minecraft', []);
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual([]);

    const missing = await SELF.fetch(`https://worker.test/profiles/minecraft/Missing${suffix}`);
    expect(missing.status).toBe(204);
  });

  it('binds hasJoined to the join IP only when the setting is enabled', async () => {
    await env.DB.prepare('UPDATE site_settings SET enforce_join_ip = 0, updated_at = ? WHERE id = 1').bind(Date.now()).run();
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
    const email = `join-ip-${suffix}@example.com`;
    const account = await registerVerifiedAccount(email, 'correct-password', `JoinIp${suffix}`);
    const authenticate = await jsonRequest('/authserver/authenticate', {
      username: email,
      password: 'correct-password',
      clientToken: `join-ip-client-${suffix}`,
    });
    expect(authenticate.status).toBe(200);
    const token = (await authenticate.json() as { accessToken: string }).accessToken;
    const sourceIp = '203.0.113.44';
    const serverId = `join-ip-server-${suffix}`;

    await env.DB.prepare('UPDATE site_settings SET enforce_join_ip = 1, updated_at = ? WHERE id = 1').bind(Date.now()).run();
    const join = await jsonRequest('/sessionserver/session/minecraft/join', {
      accessToken: token,
      selectedProfile: { id: account.profile.id },
      serverId,
    }, { 'CF-Connecting-IP': sourceIp });
    expect(join.status).toBe(204);
    await expect(env.DB.prepare('SELECT ip FROM server_sessions WHERE server_id = ?').bind(serverId).first<{ ip: string }>()).resolves.toEqual({ ip: sourceIp });

    const matching = await SELF.fetch(
      `https://worker.test/sessionserver/session/minecraft/hasJoined?username=${account.profile.name}&serverId=${serverId}&ip=${sourceIp}`,
    );
    expect(matching.status).toBe(200);

    const mismatched = await SELF.fetch(
      `https://worker.test/sessionserver/session/minecraft/hasJoined?username=${account.profile.name}&serverId=${serverId}&ip=203.0.113.45`,
    );
    expect(mismatched.status).toBe(204);

    const missingIp = await SELF.fetch(
      `https://worker.test/sessionserver/session/minecraft/hasJoined?username=${account.profile.name}&serverId=${serverId}`,
    );
    expect(missingIp.status).toBe(204);

    await env.DB.prepare('UPDATE site_settings SET enforce_join_ip = 0, updated_at = ? WHERE id = 1').bind(Date.now()).run();
    const disabled = await SELF.fetch(
      `https://worker.test/sessionserver/session/minecraft/hasJoined?username=${account.profile.name}&serverId=${serverId}&ip=203.0.113.45`,
    );
    expect(disabled.status).toBe(200);
  });

  it('returns 304 for a matching texture ETag while retaining immutable caching', async () => {
    const hash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64);
    const key = `${hash}.png`;
    await env.BUCKET.put(key, new Uint8Array([137, 80, 78, 71]), {
      httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
    });

    const initial = await SELF.fetch(`https://worker.test/textures/${hash}`);
    expect(initial.status).toBe(200);
    const etag = initial.headers.get('etag');
    expect(etag).toBeTruthy();
    expect(initial.headers.get('cache-control')).toContain('immutable');
    await expect(initial.arrayBuffer()).resolves.toEqual(new Uint8Array([137, 80, 78, 71]).buffer);

    const cached = await SELF.fetch(`https://worker.test/textures/${hash}`, {
      headers: { 'If-None-Match': etag! },
    });
    expect(cached.status).toBe(304);
    expect(cached.headers.get('etag')).toBe(etag);
    expect(cached.headers.get('cache-control')).toContain('immutable');
    expect(await cached.text()).toBe('');
  });
});
