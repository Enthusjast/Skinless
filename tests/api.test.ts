import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { clearLoginFailures } from '../src/middleware/ratelimit';
import type { ProfileRecord, TokenRecord, UserRecord } from '../src/types';

type Row = Record<string, unknown>;

class Statement {
  private values: unknown[] = [];

  public constructor(private readonly db: MemoryD1, private readonly sql: string) {}

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

  run(): Promise<{ success: true }> {
    this.db.run(this.sql, this.values);
    return Promise.resolve({ success: true });
  }

  execute(): void {
    this.db.run(this.sql, this.values);
  }
}

class MemoryD1 {
  public users = new Map<string, UserRecord>();
  public profiles = new Map<string, ProfileRecord>();
  public tokens = new Map<string, TokenRecord>();
  public sessions = new Map<string, { serverId: string; profileId: string; userId: string; expiresAt: number }>();

  prepare(sql: string): Statement {
    return new Statement(this, sql.replace(/\s+/g, ' ').trim());
  }

  batch(statements: Statement[]): Promise<unknown[]> {
    statements.forEach((statement) => statement.execute());
    return Promise.resolve([]);
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
    if (sql.startsWith('SELECT * FROM profiles WHERE id')) {
      const profile = this.profiles.get(String(values[0]));
      return profile ? { ...profile } : null;
    }
    if (sql.startsWith('SELECT COUNT(*)')) {
      const hash = values[0];
      return { count: [...this.profiles.values()].filter((profile) => profile.skin_hash === hash || profile.cape_hash === hash).length };
    }
    if (sql.includes('FROM server_sessions')) {
      const session = this.sessions.get(String(values[0]));
      const profile = session ? this.profiles.get(session.profileId) : null;
      return session && profile && profile.name === values[1] && session.expiresAt > Number(values[2]) ? { ...profile } : null;
    }
    if (sql.includes('FROM tokens t INNER JOIN users')) {
      const token = this.tokens.get(String(values[0]));
      if (!token || token.expires_at <= Number(values[1])) return null;
      const user = this.users.get(token.user_id);
      const profile = this.profiles.get(token.profile_id);
      if (!user || !profile) return null;
      return {
        ...token,
        user_email: user.email,
        user_password: user.password,
        user_salt: user.salt,
        user_role: user.role,
        user_created_at: user.created_at,
        user_updated_at: user.updated_at,
        profile_name: profile.name,
        skin_hash: profile.skin_hash,
        cape_hash: profile.cape_hash,
        skin_model: profile.skin_model,
      };
    }
    return null;
  }

  all(sql: string, values: unknown[]): Row[] {
    if (sql.includes('FROM users u INNER JOIN profiles p')) {
      const limit = Number(values[0]);
      const offset = Number(values[1]);
      return [...this.users.values()]
        .sort((left, right) => right.created_at - left.created_at)
        .slice(offset, offset + limit)
        .map((user) => {
          const profile = [...this.profiles.values()].find((candidate) => candidate.user_id === user.id)!;
          return { ...user, profile_id: profile.id, profile_name: profile.name, skin_hash: profile.skin_hash, cape_hash: profile.cape_hash, skin_model: profile.skin_model };
        });
    }
    return [];
  }

  run(sql: string, values: unknown[]): void {
    if (sql.startsWith('INSERT INTO users')) {
      const [id, email, password, salt, role, created_at, updated_at] = values;
      this.users.set(String(id), { id: String(id), email: String(email), password: String(password), salt: String(salt), role: role as UserRecord['role'], created_at: Number(created_at), updated_at: Number(updated_at) });
    } else if (sql.startsWith('INSERT INTO profiles')) {
      const [id, user_id, name, skin_hash, cape_hash, skin_model] = values;
      this.profiles.set(String(id), { id: String(id), user_id: String(user_id), name: String(name), skin_hash: skin_hash as string | null, cape_hash: cape_hash as string | null, skin_model: skin_model as ProfileRecord['skin_model'] });
    } else if (sql.startsWith('INSERT INTO tokens')) {
      const [access_token, client_token, user_id, profile_id, created_at, expires_at] = values;
      this.tokens.set(String(access_token), { access_token: String(access_token), client_token: String(client_token), user_id: String(user_id), profile_id: String(profile_id), created_at: Number(created_at), expires_at: Number(expires_at) });
    } else if (sql.startsWith('INSERT INTO server_sessions')) {
      const [serverId, profileId, userId, _createdAt, expiresAt] = values;
      this.sessions.set(String(serverId), { serverId: String(serverId), profileId: String(profileId), userId: String(userId), expiresAt: Number(expiresAt) });
    } else if (sql.startsWith('UPDATE users SET password')) {
      const [password, salt, updatedAt, userId] = values;
      const user = this.users.get(String(userId));
      if (user) this.users.set(user.id, { ...user, password: String(password), salt: String(salt), updated_at: Number(updatedAt) });
    } else if (sql.startsWith('UPDATE users SET role')) {
      const [role, updatedAt, userId] = values;
      const user = this.users.get(String(userId));
      if (user) this.users.set(user.id, { ...user, role: role as UserRecord['role'], updated_at: Number(updatedAt) });
    } else if (sql.startsWith('UPDATE profiles SET skin_hash')) {
      const [hash, model, profileId] = values;
      const profile = this.profiles.get(String(profileId));
      if (profile) this.profiles.set(profile.id, { ...profile, skin_hash: hash as string | null, skin_model: model as ProfileRecord['skin_model'] });
    } else if (sql.startsWith('UPDATE profiles SET cape_hash')) {
      const [hash, profileId] = values;
      const profile = this.profiles.get(String(profileId));
      if (profile) this.profiles.set(profile.id, { ...profile, cape_hash: hash as string | null });
    } else if (sql.startsWith('DELETE FROM tokens WHERE user_id')) {
      for (const [key, token] of this.tokens) if (token.user_id === values[0]) this.tokens.delete(key);
    } else if (sql.startsWith('DELETE FROM tokens WHERE access_token')) {
      this.tokens.delete(String(values[0]));
    }
  }
}

class MemoryBucket {
  public files = new Map<string, Uint8Array>();

  async head(key: string): Promise<R2Object | null> {
    return this.files.has(key) ? ({ key } as R2Object) : null;
  }

  async put(key: string, body: BodyInit): Promise<R2Object> {
    const data = new Uint8Array(await new Response(body).arrayBuffer());
    this.files.set(key, data);
    return { key } as R2Object;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function registeredClient() {
  const db = new MemoryD1();
  const bucket = new MemoryBucket();
  const env = { DB: db as unknown as D1Database, BUCKET: bucket as unknown as R2Bucket, API_BASE_URL: 'https://skin.example.com', SKIN_DOMAIN: 'skin.example.com' };
  const register = await app.request('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'player@example.com', password: 'correct-password', name: 'PlayerOne' }) }, env);
  expect(register.status).toBe(201);
  const login = await app.request('/authserver/authenticate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'player@example.com', password: 'correct-password', clientToken: 'client-1' }) }, env);
  const loginBody = await login.json() as { accessToken: string };
  return { db, bucket, env, token: loginBody.accessToken };
}

describe('management API', () => {
  beforeEach(() => clearLoginFailures());

  it('registers a user, uploads a skin, and removes its unreferenced R2 object', async () => {
    const { db, bucket, env, token } = await registeredClient();
    const mismatchForm = new FormData();
    mismatchForm.set('file', new File([pngHeader(64, 64).buffer as ArrayBuffer], 'skin.png', { type: 'image/png' }));
    mismatchForm.set('sha256', '0'.repeat(64));
    const mismatch = await app.request('/api/user/skin', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: mismatchForm }, env);
    expect(mismatch.status).toBe(400);
    expect(bucket.files.size).toBe(0);

    const form = new FormData();
    form.set('file', new File([pngHeader(64, 64).buffer as ArrayBuffer], 'skin.png', { type: 'image/png' }));
    form.set('skin_model', 'slim');
    const upload = await app.request('/api/user/skin', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }, env);

    expect(upload.status).toBe(201);
    expect(bucket.files.size).toBe(1);
    expect([...db.profiles.values()][0].skin_model).toBe('slim');

    const joinedProfile = [...db.profiles.values()][0];
    const join = await app.request('/sessionserver/session/minecraft/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token, selectedProfile: { id: joinedProfile.id }, serverId: 'smoke-server' }) }, env);
    expect(join.status).toBe(204);
    const hasJoined = await app.request('/sessionserver/session/minecraft/hasJoined?username=PlayerOne&serverId=smoke-server', {}, env);
    expect(hasJoined.status).toBe(200);

    const profile = await app.request('/api/user/profile', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(profile.status).toBe(200);
    await expect(profile.json()).resolves.toMatchObject({ user: { profile: { skinModel: 'slim' } } });

    const remove = await app.request('/api/user/skin', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, env);
    expect(remove.status).toBe(204);
    expect(bucket.files.size).toBe(0);
  });

  it('revokes existing tokens when the password changes', async () => {
    const { db, env, token } = await registeredClient();
    const change = await app.request('/api/user/password', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ currentPassword: 'correct-password', newPassword: 'new-password-123' }) }, env);
    expect(change.status).toBe(204);
    expect(db.tokens.size).toBe(0);

    const oldToken = await app.request('/api/user/profile', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(oldToken.status).toBe(401);
  });

  it('protects and serves the administrator user list', async () => {
    const { db, env, token } = await registeredClient();
    const user = [...db.users.values()][0];
    db.users.set(user.id, { ...user, role: 'admin' });
    const list = await app.request('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }, env);

    expect(list.status).toBe(200);
    const body = await list.json() as { users: Array<Record<string, unknown>> };
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).not.toHaveProperty('password');
    expect(body.users[0]).toMatchObject({ email: 'player@example.com', role: 'admin' });
  });
});
