import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { app } from '../../src/index';
import {
  ACCOUNT_DELETION_GRACE_PERIOD_MS,
  ACCOUNT_RESTORE_PURPOSE,
} from '../../src/utils/account';
import { registerVerifiedAccount } from './verified-registration-fixture';

const PASSWORD = 'correct-password';

interface SentRestoreCode {
  email: string;
  code: string;
}

interface WebSession {
  cookie: string;
  csrfToken: string;
}

function mailBindings(sent: SentRestoreCode[]) {
  return {
    ...env,
    MAIL_SENDER: {
      async sendVerificationCode() {},
      async sendAccountRestoreCode(email: string, code: string) {
        sent.push({ email, code });
      },
    },
  };
}

function cookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Missing ${name} cookie`);
  return match[1];
}

function cookieHeader(setCookie: string): string {
  return ['__Host-skinless_access', '__Host-skinless_refresh', 'skinless_csrf']
    .map((name) => `${name}=${cookieValue(setCookie, name)}`)
    .join('; ');
}

async function webLogin(email: string, password: string, bindings = env): Promise<WebSession> {
  const response = await app.request(
    'https://worker.test/api/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    bindings as never,
  );
  if (response.status !== 200) {
    throw new Error(`web login failed: ${response.status}`);
  }
  const setCookie = response.headers.get('set-cookie') ?? '';
  return {
    cookie: cookieHeader(setCookie),
    csrfToken: (await response.json() as { csrfToken: string }).csrfToken,
  };
}

function request(path: string, init: RequestInit = {}, bindings = env): Promise<Response> {
  return Promise.resolve(app.request(`https://worker.test${path}`, init, bindings as never));
}

function cookieRequest(
  path: string,
  method: string,
  session: WebSession,
  body: unknown,
  bindings = env,
): Promise<Response> {
  return request(path, {
    method,
    headers: {
      Cookie: session.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, bindings);
}

describe('recoverable account deletion against real D1', () => {
  it('marks an account pending, sends a restore code, and revokes every auth surface', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
    const email = `delete-${suffix}@example.com`;
    const account = await registerVerifiedAccount(email, PASSWORD, `Delete${suffix}`);
    const sent: SentRestoreCode[] = [];
    const bindings = mailBindings(sent);
    const current = await webLogin(email, PASSWORD, bindings);
    const other = await webLogin(email, PASSWORD, bindings);

    const authenticate = await request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password: PASSWORD, clientToken: `client-${suffix}` }),
    }, bindings);
    expect(authenticate.status).toBe(200);
    const token = (await authenticate.json() as { accessToken: string }).accessToken;

    const join = await request('/sessionserver/session/minecraft/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: token,
        selectedProfile: { id: account.profile.id },
        serverId: `server-${suffix}`,
      }),
    }, bindings);
    expect(join.status).toBe(204);

    const missingCsrf = await request('/api/user/deletion', {
      method: 'POST',
      headers: { Cookie: current.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: PASSWORD, confirmation: 'DELETE' }),
    }, bindings);
    expect(missingCsrf.status).toBe(403);

    const wrongPassword = await cookieRequest('/api/user/deletion', 'POST', current, {
      currentPassword: 'wrong-password',
      confirmation: 'DELETE',
    }, bindings);
    expect(wrongPassword.status).toBe(403);

    const deletion = await cookieRequest('/api/user/deletion', 'POST', current, {
      currentPassword: PASSWORD,
      confirmation: 'DELETE',
    }, bindings);
    expect(deletion.status).toBe(202);
    const deletionBody = await deletion.json() as {
      challengeId: string;
      deletionAt: number;
      status: string;
    };
    expect(deletionBody).toMatchObject({
      challengeId: expect.any(String),
      status: 'pending_deletion',
    });
    expect(deletionBody.deletionAt).toBeGreaterThan(Date.now() + ACCOUNT_DELETION_GRACE_PERIOD_MS - 5_000);
    expect(sent).toEqual([{ email, code: expect.stringMatching(/^\d{6}$/) }]);

    const userRow = await env.DB.prepare(
      'SELECT status, deletion_requested_at FROM users WHERE id = ?',
    ).bind(account.id).first<{ status: string; deletion_requested_at: number }>();
    expect(userRow).toMatchObject({ status: 'pending_deletion' });
    expect(userRow?.deletion_requested_at).toBe(deletionBody.deletionAt);
    const challenge = await env.DB.prepare(
      'SELECT purpose, expires_at FROM account_challenges WHERE id = ?',
    ).bind(deletionBody.challengeId).first<{ purpose: string; expires_at: number }>();
    expect(challenge).toMatchObject({
      purpose: ACCOUNT_RESTORE_PURPOSE,
      expires_at: deletionBody.deletionAt,
    });

    const tokenValidation = await request('/authserver/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, clientToken: `client-${suffix}` }),
    }, bindings);
    expect(tokenValidation.status).toBe(403);

    const currentProfile = await request('/api/user/profile', {
      headers: { Cookie: current.cookie },
    }, bindings);
    const otherProfile = await request('/api/user/profile', {
      headers: { Cookie: other.cookie },
    }, bindings);
    expect(currentProfile.status).toBe(401);
    expect(otherProfile.status).toBe(401);

    const newWebLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }, bindings);
    expect(newWebLogin.status).toBe(401);

    const newProtocolLogin = await request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password: PASSWORD }),
    }, bindings);
    expect(newProtocolLogin.status).toBe(403);

    const joinedAfterDeletion = await request(
      `/sessionserver/session/minecraft/hasJoined?username=${encodeURIComponent(account.profile.name)}&serverId=${encodeURIComponent(`server-${suffix}`)}`,
      {},
      bindings,
    );
    expect(joinedAfterDeletion.status).toBe(204);
    const publicProfileAfterDeletion = await request(
      `/sessionserver/session/minecraft/profile/${account.profile.id}`,
      {},
      bindings,
    );
    expect(publicProfileAfterDeletion.status).toBe(404);

    const repeated = await cookieRequest('/api/user/deletion', 'POST', current, {
      currentPassword: PASSWORD,
      confirmation: 'DELETE',
    }, bindings);
    expect(repeated.status).toBe(401);
  });

  it('restores only with the active code, consumes it, and keeps failure responses generic', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
    const email = `restore-${suffix}@example.com`;
    const account = await registerVerifiedAccount(email, PASSWORD, `Rst${suffix}`);
    const sent: SentRestoreCode[] = [];
    const bindings = mailBindings(sent);
    const session = await webLogin(email, PASSWORD, bindings);
    const deletion = await cookieRequest('/api/user/deletion', 'POST', session, {
      currentPassword: PASSWORD,
      confirmation: 'DELETE',
    }, bindings);
    const deletionBody = await deletion.json() as { challengeId: string };
    const code = sent[0]?.code;
    expect(code).toMatch(/^\d{6}$/);

    const missing = await request('/api/auth/account/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '000000' }),
    }, bindings);
    const missingBody = await missing.json();
    expect(missing.status).toBe(400);
    expect(missingBody).toMatchObject({ errorCode: 'invalid_verification_code' });

    const invalidEmail = await request('/api/auth/account/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `missing-${suffix}@example.com`, code }),
    }, bindings);
    expect(invalidEmail.status).toBe(400);
    expect(await invalidEmail.json()).toEqual(missingBody);

    const restored = await request('/api/auth/account/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, challengeId: deletionBody.challengeId, code }),
    }, bindings);
    expect(restored.status).toBe(204);

    const userRow = await env.DB.prepare(
      'SELECT status, deletion_requested_at FROM users WHERE id = ?',
    ).bind(account.id).first<{ status: string; deletion_requested_at: number | null }>();
    expect(userRow).toEqual({ status: 'active', deletion_requested_at: null });
    await expect(env.DB.prepare(
      'SELECT id FROM account_challenges WHERE id = ?',
    ).bind(deletionBody.challengeId).first()).resolves.toBeNull();

    const repeated = await request('/api/auth/account/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    }, bindings);
    expect(repeated.status).toBe(429);
    await expect(repeated.json()).resolves.toMatchObject({
      errorCode: 'account_restore_rate_limited',
    });

    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }, bindings);
    expect(login.status).toBe(200);
  });

  it('rejects expired restore codes and cron removes only a bounded batch while queueing GC', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
    const email = `cron-${suffix}@example.com`;
    const account = await registerVerifiedAccount(email, PASSWORD, `Cron${suffix}`);
    const sent: SentRestoreCode[] = [];
    const bindings = mailBindings(sent);
    const session = await webLogin(email, PASSWORD, bindings);
    const deletion = await cookieRequest('/api/user/deletion', 'POST', session, {
      currentPassword: PASSWORD,
      confirmation: 'DELETE',
    }, bindings);
    expect(deletion.status).toBe(202);
    const deletionBody = await deletion.json() as { challengeId: string };

    await env.DB.prepare('UPDATE account_challenges SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1, deletionBody.challengeId)
      .run();
    const expiredCode = await request('/api/auth/account/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: sent[0]?.code }),
    }, bindings);
    expect(expiredCode.status).toBe(400);

    const textureHash = `${suffix}${'a'.repeat(64 - suffix.length)}`;
    const profile = await env.DB.prepare(
      'SELECT id FROM profiles WHERE user_id = ? LIMIT 1',
    ).bind(account.id).first<{ id: string }>();
    await env.DB.batch([
      env.DB.prepare('UPDATE profiles SET skin_hash = ? WHERE id = ?').bind(textureHash, profile?.id),
      env.DB.prepare(
        `INSERT INTO texture_wardrobe
         (id, user_id, hash, texture_type, name, model, width, height, size, created_at, updated_at)
         VALUES (?, ?, ?, 'skin', 'Cron texture', 'classic', NULL, NULL, NULL, ?, ?)`,
      ).bind(`texture-${suffix}`, account.id, textureHash, Date.now(), Date.now()),
      env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?')
        .bind(Date.now() - 1, account.id),
    ]);

    await env.BUCKET.put(`${textureHash}.png`, new Uint8Array([1, 2, 3]));
    const cronNow = Date.now();
    await worker.scheduled?.({} as ScheduledController, env, {} as ExecutionContext);

    await expect(env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(account.id).first()).resolves.toBeNull();
    await expect(env.DB.prepare('SELECT id FROM profiles WHERE user_id = ?').bind(account.id).first()).resolves.toBeNull();
    await expect(env.DB.prepare('SELECT id FROM texture_wardrobe WHERE user_id = ?').bind(account.id).first()).resolves.toBeNull();
    await expect(env.DB.prepare('SELECT access_token FROM tokens WHERE user_id = ?').bind(account.id).first()).resolves.toBeNull();
    await expect(env.DB.prepare('SELECT id FROM web_sessions WHERE user_id = ?').bind(account.id).first()).resolves.toBeNull();
    const cleanup = await env.DB.prepare(
      'SELECT hash, scheduled_at FROM texture_cleanup WHERE hash = ?',
    ).bind(textureHash).first<{ hash: string; scheduled_at: number }>();
    expect(cleanup).toMatchObject({ hash: textureHash });
    expect(cleanup?.scheduled_at).toBeGreaterThan(cronNow);
    await expect(env.BUCKET.head(`${textureHash}.png`)).resolves.not.toBeNull();

    const batchIds = Array.from({ length: 101 }, (_, index) => `cron-batch-${suffix}-${index}`);
    await env.DB.batch(batchIds.map((id, index) => env.DB.prepare(
      `INSERT INTO users
       (id, email, password, salt, role, created_at, updated_at, default_profile_id, email_verified_at, status, deletion_requested_at)
       VALUES (?, ?, 'hash', 'salt', 'user', ?, ?, NULL, ?, 'pending_deletion', ?)`,
    ).bind(id, `${id}@example.com`, index, index, index, 1)));

    await worker.scheduled?.({} as ScheduledController, env, {} as ExecutionContext);
    const remainingAfterFirst = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM users WHERE id LIKE ? AND status = 'pending_deletion'`,
    ).bind(`cron-batch-${suffix}-%`).first<{ count: number }>();
    expect(Number(remainingAfterFirst?.count)).toBe(1);

    await worker.scheduled?.({} as ScheduledController, env, {} as ExecutionContext);
    const remainingAfterSecond = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM users WHERE id LIKE ?`,
    ).bind(`cron-batch-${suffix}-%`).first<{ count: number }>();
    expect(Number(remainingAfterSecond?.count)).toBe(0);
  });
});
