import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { registerVerifiedAccount } from './verified-registration-fixture';

interface AdminClient {
  userId: string;
  accessToken: string;
}

interface Account {
  id: string;
  email: string;
  profileId: string;
}

async function createAdmin(): Promise<AdminClient> {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `admin-controls-${suffix}@example.com`;
  const account = await registerVerifiedAccount(email, 'correct-password', `AdCtl${suffix.slice(0, 8)}`);
  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind('admin', account.id).run();
  const response = await SELF.fetch('https://worker.test/authserver/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: email,
      password: 'correct-password',
      clientToken: `admin-controls-client-${suffix}`,
    }),
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { accessToken: string };
  return { userId: account.id, accessToken: body.accessToken };
}

async function createAccount(): Promise<Account> {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `admin-target-${suffix}@example.com`;
  const account = await registerVerifiedAccount(email, 'correct-password', `Target${suffix.slice(0, 9)}`);
  return { id: account.id, email, profileId: account.profile.id };
}

function adminRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return SELF.fetch(`https://worker.test${path}`, { ...init, headers });
}

function adminJsonRequest(
  path: string,
  accessToken: string,
  method: string,
  body: unknown,
): Promise<Response> {
  return adminRequest(path, accessToken, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('administrator account controls against real D1', () => {
  it('lists each account status without exposing credentials or session data', async () => {
    const admin = await createAdmin();
    const response = await SELF.fetch('https://worker.test/api/admin/users', {
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { users: Array<Record<string, unknown>> };
    const listed = body.users.find((user) => user.id === admin.userId);
    expect(listed).toMatchObject({ id: admin.userId, role: 'admin', status: 'active' });
    expect(listed).not.toHaveProperty('password');
    expect(listed).not.toHaveProperty('salt');
    expect(listed).not.toHaveProperty('token');
    expect(listed).not.toHaveProperty('ip');
  });

  it('requires typed confirmation for disable and allows a disabled account to be re-enabled', async () => {
    const admin = await createAdmin();
    const target = await createAccount();

    const missingConfirmation = await adminJsonRequest(
      `/api/admin/users/${target.id}/status`,
      admin.accessToken,
      'PATCH',
      { status: 'disabled' },
    );
    expect(missingConfirmation.status).toBe(400);
    await expect(missingConfirmation.json()).resolves.toMatchObject({
      errorCode: 'confirmation_required',
    });

    const disabled = await adminJsonRequest(
      `/api/admin/users/${target.id}/status`,
      admin.accessToken,
      'PATCH',
      { status: 'disabled', confirmation: 'DISABLE' },
    );
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      user: { id: target.id, status: 'disabled' },
    });
    await expect(env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(target.id).first())
      .resolves.toEqual({ status: 'disabled' });

    const loginWhileDisabled = await SELF.fetch('https://worker.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: target.email, password: 'correct-password' }),
    });
    expect(loginWhileDisabled.status).toBe(401);

    const protocolLoginWhileDisabled = await SELF.fetch('https://worker.test/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: target.email,
        password: 'correct-password',
        clientToken: `disabled-client-${crypto.randomUUID()}`,
      }),
    });
    expect(protocolLoginWhileDisabled.status).toBe(403);

    const enabled = await adminJsonRequest(
      `/api/admin/users/${target.id}/status`,
      admin.accessToken,
      'PATCH',
      { status: 'active' },
    );
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toMatchObject({
      user: { id: target.id, status: 'active' },
    });
  });

  it('protects the last active administrator from self-lockout, demotion, and deletion', async () => {
    const admin = await createAdmin();

    const disable = await adminJsonRequest(
      `/api/admin/users/${admin.userId}/status`,
      admin.accessToken,
      'PATCH',
      { status: 'disabled', confirmation: 'DISABLE' },
    );
    expect(disable.status).toBe(409);
    await expect(disable.json()).resolves.toMatchObject({ errorCode: 'admin_self_lockout' });

    const demote = await adminJsonRequest(
      `/api/admin/users/${admin.userId}/role`,
      admin.accessToken,
      'PUT',
      { role: 'user', confirmation: 'DEMOTE' },
    );
    expect(demote.status).toBe(409);
    await expect(demote.json()).resolves.toMatchObject({ errorCode: 'admin_self_lockout' });

    const deletion = await adminJsonRequest(
      `/api/admin/users/${admin.userId}`,
      admin.accessToken,
      'DELETE',
      { confirmation: 'DELETE' },
    );
    expect(deletion.status).toBe(409);
    await expect(deletion.json()).resolves.toMatchObject({ errorCode: 'admin_self_lockout' });
  });

  it('revokes a target account’s web, protocol, and server sessions after confirmation', async () => {
    const admin = await createAdmin();
    const target = await createAccount();
    const now = Date.now();
    const webSessionId = crypto.randomUUID();
    const accessToken = `admin-control-token-${crypto.randomUUID()}`;
    const serverId = `admin-control-server-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO web_sessions
         (id, user_id, refresh_token_hash, csrf_token_hash, device_label, created_at, last_used_at, expires_at, revoked_at)
         VALUES (?, ?, 'refresh-hash', 'csrf-hash', 'test device', ?, ?, ?, NULL)`,
      ).bind(webSessionId, target.id, now, now, now + 60_000),
      env.DB.prepare(
        `INSERT INTO tokens
         (access_token, client_token, user_id, profile_id, created_at, expires_at)
         VALUES (?, 'client', ?, ?, ?, ?)`,
      ).bind(accessToken, target.id, target.profileId, now, now + 60_000),
      env.DB.prepare(
        `INSERT INTO server_sessions
         (server_id, profile_id, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(serverId, target.profileId, target.id, now, now + 60_000),
    ]);

    const missingConfirmation = await adminJsonRequest(
      `/api/admin/users/${target.id}/sessions`,
      admin.accessToken,
      'DELETE',
      {},
    );
    expect(missingConfirmation.status).toBe(400);
    await expect(missingConfirmation.json()).resolves.toMatchObject({
      errorCode: 'confirmation_required',
    });

    const revoked = await adminJsonRequest(
      `/api/admin/users/${target.id}/sessions`,
      admin.accessToken,
      'DELETE',
      { confirmation: 'REVOKE' },
    );
    expect(revoked.status).toBe(204);
    await expect(env.DB.prepare('SELECT access_token FROM tokens WHERE user_id = ?').bind(target.id).first())
      .resolves.toBeNull();
    await expect(env.DB.prepare('SELECT server_id FROM server_sessions WHERE user_id = ?').bind(target.id).first())
      .resolves.toBeNull();
    await expect(env.DB.prepare('SELECT revoked_at FROM web_sessions WHERE id = ?').bind(webSessionId).first())
      .resolves.toMatchObject({ revoked_at: expect.any(Number) });
  });

  it('cascades permanent deletion and queues unreferenced textures without deleting R2', async () => {
    const admin = await createAdmin();
    const target = await createAccount();
    const now = Date.now();
    const hash = crypto.randomUUID().replaceAll('-', '') + 'texture';
    const textureId = crypto.randomUUID();
    const token = `delete-target-token-${crypto.randomUUID()}`;
    const webSessionId = crypto.randomUUID();
    const serverId = `delete-target-server-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare('UPDATE profiles SET skin_hash = ? WHERE id = ?').bind(hash, target.profileId),
      env.DB.prepare(
        `INSERT INTO texture_wardrobe
         (id, user_id, hash, texture_type, name, model, width, height, size, created_at, updated_at)
         VALUES (?, ?, ?, 'skin', 'Delete texture', 'classic', NULL, NULL, NULL, ?, ?)`,
      ).bind(textureId, target.id, hash, now, now),
      env.DB.prepare(
        `INSERT INTO tokens
         (access_token, client_token, user_id, profile_id, created_at, expires_at)
         VALUES (?, 'client', ?, ?, ?, ?)`,
      ).bind(token, target.id, target.profileId, now, now + 60_000),
      env.DB.prepare(
        `INSERT INTO web_sessions
         (id, user_id, refresh_token_hash, csrf_token_hash, device_label, created_at, last_used_at, expires_at, revoked_at)
         VALUES (?, ?, 'refresh-hash', 'csrf-hash', 'test device', ?, ?, ?, NULL)`,
      ).bind(webSessionId, target.id, now, now, now + 60_000),
      env.DB.prepare(
        `INSERT INTO server_sessions
         (server_id, profile_id, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(serverId, target.profileId, target.id, now, now + 60_000),
    ]);
    await env.BUCKET.put(`${hash}.png`, new Uint8Array([1, 2, 3]));

    const wrongConfirmation = await adminJsonRequest(
      `/api/admin/users/${target.id}`,
      admin.accessToken,
      'DELETE',
      { confirmation: 'REMOVE' },
    );
    expect(wrongConfirmation.status).toBe(400);
    await expect(wrongConfirmation.json()).resolves.toMatchObject({
      errorCode: 'invalid_confirmation',
    });

    const deleted = await adminJsonRequest(
      `/api/admin/users/${target.id}`,
      admin.accessToken,
      'DELETE',
      { confirmation: 'DELETE' },
    );
    expect(deleted.status).toBe(204);
    await expect(env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(target.id).first()).resolves.toBeNull();
    await expect(env.DB.prepare('SELECT id FROM profiles WHERE user_id = ?').bind(target.id).first()).resolves.toBeNull();
    await expect(env.DB.prepare('SELECT id FROM texture_wardrobe WHERE user_id = ?').bind(target.id).first()).resolves.toBeNull();
    await expect(env.DB.prepare('SELECT access_token FROM tokens WHERE access_token = ?').bind(token).first()).resolves.toBeNull();
    await expect(env.DB.prepare('SELECT id FROM web_sessions WHERE id = ?').bind(webSessionId).first()).resolves.toBeNull();
    await expect(env.DB.prepare('SELECT server_id FROM server_sessions WHERE server_id = ?').bind(serverId).first()).resolves.toBeNull();
    const cleanup = await env.DB.prepare(
      'SELECT hash, scheduled_at FROM texture_cleanup WHERE hash = ?',
    ).bind(hash).first<{ hash: string; scheduled_at: number }>();
    expect(cleanup).toMatchObject({ hash });
    expect(cleanup?.scheduled_at).toBeGreaterThan(now);
    await expect(env.BUCKET.head(`${hash}.png`)).resolves.not.toBeNull();
  });
});
