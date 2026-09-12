import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../src/utils/session';
import { registerVerifiedAccount } from './verified-registration-fixture';

interface AuthenticatedClient {
  userId: string;
  accessToken: string;
}

async function jsonRequest(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createClient(role: 'user' | 'admin'): Promise<AuthenticatedClient> {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `registration-settings-${suffix}@example.com`;
  const registerBody = { user: await registerVerifiedAccount(email, 'correct-password', `Invite${suffix.slice(0, 8)}`) };

  if (role === 'admin') {
    await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind('admin', registerBody.user.id).run();
  } else {
    await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind('user', registerBody.user.id).run();
  }

  const authenticate = await jsonRequest('/authserver/authenticate', {
    username: email,
    password: 'correct-password',
    clientToken: `registration-settings-client-${suffix}`,
  });
  expect(authenticate.status).toBe(200);
  const authenticateBody = await authenticate.json() as { accessToken: string };
  return { userId: registerBody.user.id, accessToken: authenticateBody.accessToken };
}

function adminRequest(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return SELF.fetch(`https://worker.test${path}`, { ...init, headers });
}

function adminJsonRequest(path: string, accessToken: string, method: string, body?: unknown): Promise<Response> {
  return adminRequest(path, accessToken, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('registration settings and invite management on real D1', () => {
  it('reads validated defaults and rejects out-of-range settings updates', async () => {
    const admin = await createClient('admin');
    const defaults = await adminRequest('/api/admin/settings', admin.accessToken);

    expect(defaults.status).toBe(200);
    await expect(defaults.json()).resolves.toMatchObject({
      settings: {
        registrationMode: 'open',
        maxProfilesPerUser: 5,
        maxTexturesPerUser: 50,
        enforceJoinIp: false,
      },
    });

    const updated = await adminJsonRequest('/api/admin/settings', admin.accessToken, 'PATCH', {
      registrationMode: 'invite',
      maxProfilesPerUser: 7,
      maxTexturesPerUser: 70,
      enforceJoinIp: true,
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      settings: {
        registrationMode: 'invite',
        maxProfilesPerUser: 7,
        maxTexturesPerUser: 70,
        enforceJoinIp: true,
      },
    });

    const restored = await adminJsonRequest('/api/admin/settings', admin.accessToken, 'PATCH', {
      registrationMode: 'open',
      maxProfilesPerUser: 5,
      maxTexturesPerUser: 50,
      enforceJoinIp: false,
    });
    expect(restored.status).toBe(200);

    for (const [field, value, code] of [
      ['maxProfilesPerUser', 0, 'invalid_profile_quota'],
      ['maxTexturesPerUser', 501, 'invalid_texture_quota'],
      ['registrationMode', 'invite-only', 'invalid_registration_mode'],
    ] as const) {
      const response = await adminJsonRequest('/api/admin/settings', admin.accessToken, 'PATCH', { [field]: value });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ errorCode: code });
    }
  });

  it('hashes new invite codes, returns plaintext once, redacts lists, and revokes codes', async () => {
    const admin = await createClient('admin');
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const create = await adminJsonRequest('/api/admin/invites', admin.accessToken, 'POST', {
      useLimit: 2,
      expiresAt,
      note: 'Launch group',
    });

    expect(create.status).toBe(201);
    const createBody = await create.json() as {
      invite: {
        id: string;
        code: string;
        codePrefix: string;
        useCount: number;
        useLimit: number;
      };
    };
    expect(createBody.invite.code).toEqual(expect.any(String));
    expect(createBody.invite.codePrefix).toBe(createBody.invite.code.slice(0, 8));
    expect(createBody.invite.useCount).toBe(0);
    expect(createBody.invite.useLimit).toBe(2);

    const stored = await env.DB.prepare(
      'SELECT code_hash, code_prefix, created_by, use_count, use_limit, expires_at, note, revoked_at FROM registration_invites WHERE id = ?',
    ).bind(createBody.invite.id).first<{
      code_hash: string;
      code_prefix: string;
      created_by: string;
      use_count: number;
      use_limit: number;
      expires_at: number;
      note: string;
      revoked_at: number | null;
    }>();
    expect(stored).toMatchObject({
      code_prefix: createBody.invite.codePrefix,
      created_by: admin.userId,
      use_count: 0,
      use_limit: 2,
      expires_at: expiresAt,
      note: 'Launch group',
      revoked_at: null,
    });
    expect(stored?.code_hash).toBe(await hashSessionToken(createBody.invite.code));
    expect(stored?.code_hash).not.toBe(createBody.invite.code);

    const list = await adminRequest('/api/admin/invites', admin.accessToken);
    expect(list.status).toBe(200);
    const listBody = await list.json() as { invites: Array<Record<string, unknown>> };
    expect(listBody.invites).toHaveLength(1);
    expect(listBody.invites[0]).toMatchObject({ id: createBody.invite.id, codePrefix: createBody.invite.codePrefix });
    expect(listBody.invites[0]).not.toHaveProperty('code');
    expect(listBody.invites[0]).not.toHaveProperty('codeHash');

    const revoke = await adminJsonRequest(
      `/api/admin/invites/${encodeURIComponent(createBody.invite.id)}/revoke`,
      admin.accessToken,
      'POST',
    );
    expect(revoke.status).toBe(200);
    await expect(revoke.json()).resolves.toMatchObject({
      invite: { id: createBody.invite.id, revokedAt: expect.any(Number) },
    });
  });

  it('keeps settings and invites behind authentication and the admin role', async () => {
    const user = await createClient('user');
    const unauthenticated = await SELF.fetch('https://worker.test/api/admin/settings');
    expect(unauthenticated.status).toBe(401);

    const settings = await adminRequest('/api/admin/settings', user.accessToken);
    expect(settings.status).toBe(403);
    const invites = await adminJsonRequest('/api/admin/invites', user.accessToken, 'POST', {});
    expect(invites.status).toBe(403);
  });
});
