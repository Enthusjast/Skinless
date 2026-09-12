import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { clearLoginFailures } from '../src/middleware/ratelimit';
import { hashPassword } from '../src/utils/crypto';
import type { ProfileRecord, UserRecord, WebSessionRecord } from '../src/types';

type Row = Record<string, unknown>;

class Statement {
  private values: unknown[] = [];

  public constructor(private readonly db: SessionD1, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve(this.db.first(this.sql, this.values) as T | null);
  }

  all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({ results: this.db.all(this.sql, this.values) as T[] });
  }

  run(): Promise<{ success: true; meta: { changes: number } }> {
    return Promise.resolve({ success: true, meta: { changes: this.db.run(this.sql, this.values) } });
  }
}

class SessionD1 {
  public users = new Map<string, UserRecord>();
  public profiles = new Map<string, ProfileRecord>();
  public webSessions = new Map<string, WebSessionRecord>();

  prepare(sql: string): Statement {
    return new Statement(this, sql.replace(/\s+/g, ' ').trim());
  }

  first(sql: string, values: unknown[]): Row | null {
    if (sql.startsWith('SELECT * FROM users WHERE email')) {
      const user = [...this.users.values()].find((candidate) => candidate.email === values[0]);
      return user ? { ...user } : null;
    }
    if (sql.startsWith('SELECT * FROM users WHERE id')) {
      const user = this.users.get(String(values[0]));
      return user ? { ...user } : null;
    }
    if (sql.startsWith('SELECT * FROM profiles WHERE user_id')) {
      const profile = [...this.profiles.values()].find((candidate) => candidate.user_id === values[0]);
      return profile ? { ...profile } : null;
    }
    if (sql.startsWith('SELECT * FROM web_sessions WHERE id')) {
      const session = this.webSessions.get(String(values[0]));
      return session ? { ...session } : null;
    }
    return null;
  }

  all(sql: string, values: unknown[]): Row[] {
    if (sql.startsWith('SELECT id, device_label, created_at, last_used_at')) {
      return [...this.webSessions.values()]
        .filter((session) => session.user_id === values[0] && session.revoked_at === null && session.expires_at > Number(values[1]))
        .sort((left, right) => right.last_used_at - left.last_used_at)
        .map((session) => ({ ...session }));
    }
    return [];
  }

  run(sql: string, values: unknown[]): number {
    if (sql.startsWith('INSERT INTO web_sessions')) {
      const [id, userId, refreshHash, csrfHash, deviceLabel, createdAt, lastUsedAt, expiresAt, revokedAt] = values;
      this.webSessions.set(String(id), {
        id: String(id),
        user_id: String(userId),
        refresh_token_hash: String(refreshHash),
        csrf_token_hash: String(csrfHash),
        device_label: String(deviceLabel),
        created_at: Number(createdAt),
        last_used_at: Number(lastUsedAt),
        expires_at: Number(expiresAt),
        revoked_at: revokedAt === null ? null : Number(revokedAt),
      });
      return 1;
    }
    if (sql.startsWith('UPDATE web_sessions SET refresh_token_hash')) {
      const [refreshHash, csrfHash, lastUsedAt, id, previousRefreshHash] = values;
      const session = this.webSessions.get(String(id));
      if (!session || session.revoked_at !== null || session.refresh_token_hash !== previousRefreshHash) return 0;
      this.webSessions.set(session.id, {
        ...session,
        refresh_token_hash: String(refreshHash),
        csrf_token_hash: String(csrfHash),
        last_used_at: Number(lastUsedAt),
      });
      return 1;
    }
    if (sql.startsWith('UPDATE web_sessions SET last_used_at')) {
      const [lastUsedAt, id] = values;
      const session = this.webSessions.get(String(id));
      if (!session || session.revoked_at !== null) return 0;
      this.webSessions.set(session.id, { ...session, last_used_at: Number(lastUsedAt) });
      return 1;
    }
    if (sql.startsWith('UPDATE web_sessions SET revoked_at')) {
      const [revokedAt, firstId, secondId] = values;
      if (sql.includes('user_id = ? AND id <> ?')) {
        let changes = 0;
        for (const session of this.webSessions.values()) {
          if (session.user_id === firstId && session.id !== secondId && session.revoked_at === null) {
            this.webSessions.set(session.id, { ...session, revoked_at: Number(revokedAt) });
            changes += 1;
          }
        }
        return changes;
      }
      if (sql.includes('user_id = ? AND revoked_at IS NULL')) {
        let changes = 0;
        for (const session of this.webSessions.values()) {
          if (session.user_id === firstId && session.revoked_at === null) {
            this.webSessions.set(session.id, { ...session, revoked_at: Number(revokedAt) });
            changes += 1;
          }
        }
        return changes;
      }
      const session = this.webSessions.get(String(firstId));
      if (!session || session.revoked_at !== null) return 0;
      this.webSessions.set(session.id, { ...session, revoked_at: Number(revokedAt) });
      return 1;
    }
    return 0;
  }
}

const user: UserRecord = {
  id: 'user-1',
  email: 'player@example.com',
  password: '',
  salt: 'fixture-salt',
  role: 'user',
  created_at: 1,
  updated_at: 1,
};

const profile: ProfileRecord = {
  id: '0123456789abcdef0123456789abcdef',
  user_id: user.id,
  name: 'PlayerOne',
  skin_hash: null,
  cape_hash: null,
  skin_model: 'classic',
};

async function createEnv(): Promise<{ db: SessionD1; env: Record<string, unknown> }> {
  const db = new SessionD1();
  db.users.set(user.id, { ...user, password: await hashPassword('correct-password', user.salt) });
  db.profiles.set(profile.id, profile);
  return {
    db,
    env: {
      DB: db,
      BUCKET: {},
      WEB_SESSION_SECRET: 'web-session-test-secret',
      API_BASE_URL: 'https://skin.example.com',
      SKIN_DOMAIN: 'skin.example.com',
    },
  };
}

function cookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Missing ${name} cookie`);
  return match[1];
}

function cookieHeader(setCookie: string): string {
  return [
    '__Host-skinless_access',
    '__Host-skinless_refresh',
    'skinless_csrf',
  ].map((name) => `${name}=${cookieValue(setCookie, name)}`).join('; ');
}

describe('secure web sessions', () => {
  beforeEach(() => clearLoginFailures());

  it('logs in with a generic user response and exact secure cookie attributes', async () => {
    const { db, env } = await createEnv();
    const response = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ email: 'PLAYER@example.com', password: 'correct-password' }),
    }, env);

    expect(response.status).toBe(200);
    const body = await response.json() as { user: { id: string; email: string; profile: { name: string } }; csrfToken: string };
    expect(body).toMatchObject({
      user: { id: user.id, email: user.email, profile: { name: profile.name } },
      csrfToken: expect.any(String),
    });
    expect(db.webSessions.size).toBe(1);
    expect([...db.webSessions.values()][0].device_label).toBe('Chrome on macOS');
    expect([...db.webSessions.values()][0].refresh_token_hash).not.toContain('web-session-test-secret');
    expect([...db.webSessions.values()][0].csrf_token_hash).not.toBe(body.csrfToken);

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('__Host-skinless_access=');
    expect(setCookie).toContain('__Host-skinless_refresh=');
    expect(setCookie).toContain('Max-Age=900');
    expect(setCookie).toContain('Max-Age=2592000');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('skinless_csrf=');
  });

  it('authenticates management requests with the access cookie and rejects missing CSRF', async () => {
    const { env } = await createEnv();
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'correct-password' }),
    }, env);
    const setCookie = login.headers.get('set-cookie') ?? '';
    const cookies = cookieHeader(setCookie);
    const csrfToken = (await login.json() as { csrfToken: string }).csrfToken;

    const profileResponse = await app.request('/api/user/profile', { headers: { Cookie: cookies } }, env);
    expect(profileResponse.status).toBe(200);
    await expect(profileResponse.json()).resolves.toMatchObject({ user: { id: user.id } });

    const rejected = await app.request('/api/user/skin', {
      method: 'DELETE',
      headers: { Cookie: cookies },
    }, env);
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toMatchObject({ errorCode: 'forbidden' });

    const accepted = await app.request('/api/user/skin', {
      method: 'DELETE',
      headers: { Cookie: cookies, 'X-CSRF-Token': csrfToken },
    }, env);
    expect(accepted.status).toBe(204);
  });

  it('rotates refresh tokens and revokes the session when an old token is replayed', async () => {
    const { db, env } = await createEnv();
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'correct-password' }),
    }, env);
    const oldSetCookie = login.headers.get('set-cookie') ?? '';
    const oldCookies = cookieHeader(oldSetCookie);
    const oldRefresh = cookieValue(oldSetCookie, '__Host-skinless_refresh');
    const oldCsrf = (await login.json() as { csrfToken: string }).csrfToken;

    const refresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: oldCookies, 'X-CSRF-Token': oldCsrf },
    }, env);
    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json() as { csrfToken: string; user: { id: string } };
    const newSetCookie = refresh.headers.get('set-cookie') ?? '';
    expect(cookieValue(newSetCookie, '__Host-skinless_refresh')).not.toBe(oldRefresh);
    expect(refreshBody.csrfToken).not.toBe(oldCsrf);

    const replay = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        Cookie: `__Host-skinless_refresh=${oldRefresh}; skinless_csrf=${oldCsrf}`,
        'X-CSRF-Token': oldCsrf,
      },
    }, env);
    expect(replay.status).toBe(401);
    expect([...db.webSessions.values()][0].revoked_at).not.toBeNull();
  });

  it('revokes the current session and clears all browser cookies on logout', async () => {
    const { db, env } = await createEnv();
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'correct-password' }),
    }, env);
    const setCookie = login.headers.get('set-cookie') ?? '';
    const cookies = cookieHeader(setCookie);
    const csrfToken = (await login.json() as { csrfToken: string }).csrfToken;

    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookies, 'X-CSRF-Token': csrfToken },
    }, env);
    expect(logout.status).toBe(204);
    expect([...db.webSessions.values()][0].revoked_at).not.toBeNull();
    const cleared = logout.headers.get('set-cookie') ?? '';
    expect(cleared).toContain('__Host-skinless_access=;');
    expect(cleared).toContain('__Host-skinless_refresh=;');
    expect(cleared).toContain('skinless_csrf=;');
    expect(cleared.match(/Max-Age=0/g)).toHaveLength(3);

    const afterLogout = await app.request('/api/user/profile', { headers: { Cookie: cookies } }, env);
    expect(afterLogout.status).toBe(401);
  });

  it('lists only safe session metadata and revokes one or all other sessions', async () => {
    const { env } = await createEnv();
    const firstLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/120.0' },
      body: JSON.stringify({ email: user.email, password: 'correct-password' }),
    }, env);
    const firstSetCookie = firstLogin.headers.get('set-cookie') ?? '';
    const firstSessionId = cookieValue(firstSetCookie, '__Host-skinless_refresh').split('.')[0];

    const secondLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36' },
      body: JSON.stringify({ email: user.email, password: 'correct-password' }),
    }, env);
    const secondSetCookie = secondLogin.headers.get('set-cookie') ?? '';
    const secondCookies = cookieHeader(secondSetCookie);
    const secondCsrf = (await secondLogin.json() as { csrfToken: string }).csrfToken;

    const list = await app.request('/api/auth/sessions', { headers: { Cookie: secondCookies } }, env);
    expect(list.status).toBe(200);
    const listed = await list.json() as { sessions: Array<Record<string, unknown>> };
    expect(listed.sessions).toHaveLength(2);
    expect(listed.sessions.find((session) => session.current)).toMatchObject({ current: true, deviceLabel: 'Chrome on Android' });
    expect(listed.sessions[0]).toEqual(expect.objectContaining({ id: expect.any(String), deviceLabel: expect.any(String), createdAt: expect.any(Number), lastUsedAt: expect.any(Number), current: expect.any(Boolean) }));
    expect(listed.sessions[0]).not.toHaveProperty('ip');
    expect(listed.sessions[0]).not.toHaveProperty('token');
    expect(listed.sessions[0]).not.toHaveProperty('userAgent');

    const revokeOne = await app.request(`/api/auth/sessions/${firstSessionId}`, {
      method: 'DELETE',
      headers: { Cookie: secondCookies, 'X-CSRF-Token': secondCsrf },
    }, env);
    expect(revokeOne.status).toBe(204);

    const afterOne = await app.request('/api/auth/sessions', { headers: { Cookie: secondCookies } }, env);
    await expect(afterOne.json()).resolves.toMatchObject({ sessions: [expect.objectContaining({ current: true })] });

    const thirdLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'correct-password' }),
    }, env);
    const thirdSetCookie = thirdLogin.headers.get('set-cookie') ?? '';
    const thirdCookies = cookieHeader(thirdSetCookie);
    const thirdCsrf = (await thirdLogin.json() as { csrfToken: string }).csrfToken;
    const revokeOthers = await app.request('/api/auth/sessions?scope=other', {
      method: 'DELETE',
      headers: { Cookie: thirdCookies, 'X-CSRF-Token': thirdCsrf },
    }, env);
    expect(revokeOthers.status).toBe(204);
    const afterOthers = await app.request('/api/auth/sessions', { headers: { Cookie: thirdCookies } }, env);
    await expect(afterOthers.json()).resolves.toMatchObject({ sessions: [expect.objectContaining({ current: true })] });
  });

  it('revokes every web session when the password changes', async () => {
    const { db, env } = await createEnv();
    const firstLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'correct-password' }),
    }, env);
    const secondLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'correct-password' }),
    }, env);
    const secondSetCookie = secondLogin.headers.get('set-cookie') ?? '';
    const secondCookies = cookieHeader(secondSetCookie);
    const csrfToken = (await secondLogin.json() as { csrfToken: string }).csrfToken;

    const change = await app.request('/api/user/password', {
      method: 'PUT',
      headers: {
        Cookie: secondCookies,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ currentPassword: 'correct-password', newPassword: 'new-password-123' }),
    }, env);
    expect(change.status).toBe(204);
    expect([...db.webSessions.values()].every((session) => session.revoked_at !== null)).toBe(true);

    const firstCookies = cookieHeader(firstLogin.headers.get('set-cookie') ?? '');
    const oldSession = await app.request('/api/user/profile', { headers: { Cookie: firstCookies } }, env);
    expect(oldSession.status).toBe(401);
  });
});
