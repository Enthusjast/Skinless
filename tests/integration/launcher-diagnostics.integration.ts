import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { registerVerifiedAccount } from './verified-registration-fixture';

async function jsonRequest(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('launcher setup diagnostics on the real worker', () => {
  it('requires authentication and redacts deployment secrets', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
    const email = `diagnostics-${suffix}@example.com`;
    const account = await registerVerifiedAccount(email, 'correct-password', `Diag${suffix}`);
    const authenticate = await jsonRequest('/authserver/authenticate', {
      username: email,
      password: 'correct-password',
      clientToken: `diagnostics-client-${suffix}`,
    });
    expect(authenticate.status).toBe(200);
    const token = (await authenticate.json() as { accessToken: string }).accessToken;

    await env.DB.prepare('UPDATE site_settings SET enforce_join_ip = 1, updated_at = ? WHERE id = 1')
      .bind(Date.now())
      .run();

    const unauthenticated = await SELF.fetch('https://worker.test/api/user/diagnostics');
    expect(unauthenticated.status).toBe(401);

    const response = await SELF.fetch('https://worker.test/api/user/diagnostics', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown> & {
      profile: Record<string, unknown>;
    };

    expect(body).toMatchObject({
      authServerUrl: 'http://localhost:8787/api/yggdrasil',
      metadataUrl: 'http://localhost:8787/api/yggdrasil',
      metadataReachable: true,
      publicKeyConfigured: true,
      textureDomainConfigured: true,
      profileAvailable: true,
      textureAvailable: false,
      ipBindingEnabled: true,
      profile: { id: account.profile.id, name: account.profile.name, textureUrl: null },
    });
    expect(typeof body.version).toBe('string');
    expect(typeof body.sameOrigin).toBe('boolean');
    expect(JSON.stringify(body)).not.toContain('BEGIN PRIVATE KEY');
    expect(JSON.stringify(body)).not.toMatch(/password|token|secret|header|ipAddress/i);

    const hash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64);
    await env.BUCKET.put(`${hash}.png`, new Uint8Array([137, 80, 78, 71]));
    await env.DB.prepare('UPDATE profiles SET skin_hash = ?, updated_at = ? WHERE id = ?')
      .bind(hash, Date.now(), account.profile.id)
      .run();
    const withTexture = await SELF.fetch('https://worker.test/api/user/diagnostics', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(withTexture.status).toBe(200);
    await expect(withTexture.json()).resolves.toMatchObject({
      textureAvailable: true,
      profile: { textureUrl: `http://localhost:8787/textures/${hash}` },
    });

    await env.DB.prepare('UPDATE site_settings SET enforce_join_ip = 0, updated_at = ? WHERE id = 1')
      .bind(Date.now())
      .run();
  });
});
