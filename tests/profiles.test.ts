import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { clearLoginFailures } from '../src/middleware/ratelimit';
import { hashPassword } from '../src/utils/crypto';
import type { ProfileRecord, TokenRecord, UserRecord } from '../src/types';
import { createTestRateLimiterNamespace } from './fixtures/rate-limiter';

type Row = Record<string, unknown>;

class ProfileStatement {
  private values: unknown[] = [];

  public constructor(private readonly database: ProfileDatabase, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve(this.database.first(this.sql, this.values) as T | null);
  }

  all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({ results: this.database.all(this.sql, this.values) as T[] });
  }

  run(): Promise<{ success: true; meta: { changes: number } }> {
    const changes = this.database.run(this.sql, this.values);
    return Promise.resolve({ success: true, meta: { changes } });
  }

  execute(): void {
    this.database.run(this.sql, this.values);
  }
}

class ProfileDatabase {
  public users = new Map<string, UserRecord>();
  public profiles = new Map<string, ProfileRecord>();
  public tokens = new Map<string, TokenRecord>();

  prepare(sql: string): ProfileStatement {
    return new ProfileStatement(this, sql.replace(/\s+/g, ' ').trim());
  }

  batch(statements: ProfileStatement[]): Promise<unknown[]> {
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
    if (sql.startsWith('SELECT * FROM profiles WHERE id')) {
      const profile = this.profiles.get(String(values[0]));
      if (sql.includes('AND user_id = ?') && profile?.user_id !== values[1]) return null;
      return profile ? { ...profile } : null;
    }
    if (sql.includes('SELECT COUNT(*) AS count FROM profiles WHERE user_id')) {
      return { count: [...this.profiles.values()].filter((profile) => profile.user_id === values[0]).length };
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
    if (sql.includes('SELECT id FROM profiles WHERE user_id')) {
      const userId = String(values[0]);
      const profile = [...this.profiles.values()]
        .filter((candidate) => candidate.user_id === userId)
        .sort((left, right) => (left.created_at ?? 0) - (right.created_at ?? 0))[0];
      return profile ? { id: profile.id } : null;
    }
    return null;
  }

  all(sql: string, values: unknown[]): Row[] {
    if (sql.includes('FROM profiles') && sql.includes('user_id = ?')) {
      return [...this.profiles.values()]
        .filter((profile) => profile.user_id === values[0])
        .sort((left, right) => {
          const created = (left.created_at ?? 0) - (right.created_at ?? 0);
          return created || left.id.localeCompare(right.id);
        })
        .map((profile) => ({ ...profile }));
    }
    return [];
  }

  run(sql: string, values: unknown[]): number {
    if (sql.startsWith('INSERT INTO tokens')) {
      const [access_token, client_token, user_id, profile_id, created_at, expires_at] = values;
      this.tokens.set(String(access_token), {
        access_token: String(access_token),
        client_token: String(client_token),
        user_id: String(user_id),
        profile_id: String(profile_id),
        created_at: Number(created_at),
        expires_at: Number(expires_at),
      });
      return 1;
    }
    if (sql.startsWith('INSERT INTO profiles')) {
      const [id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at] = values;
      if ([...this.profiles.values()].some((profile) => profile.name.toLowerCase() === String(name).toLowerCase())) {
        throw new Error('UNIQUE constraint failed: profiles.name');
      }
      this.profiles.set(String(id), {
        id: String(id),
        user_id: String(user_id),
        name: String(name),
        skin_hash: (skin_hash as string | null) ?? null,
        cape_hash: (cape_hash as string | null) ?? null,
        skin_model: skin_model as ProfileRecord['skin_model'],
        created_at: Number(created_at),
        updated_at: Number(updated_at),
      });
      return 1;
    }
    if (sql.startsWith('UPDATE profiles SET name')) {
      const [name, updatedAt, profileId] = values;
      const profile = this.profiles.get(String(profileId));
      if (!profile) return 0;
      if ([...this.profiles.values()].some((candidate) => candidate.id !== profile.id && candidate.name.toLowerCase() === String(name).toLowerCase())) {
        throw new Error('UNIQUE constraint failed: profiles.name');
      }
      this.profiles.set(profile.id, { ...profile, name: String(name), updated_at: Number(updatedAt) });
      return 1;
    }
    if (sql.startsWith('UPDATE users SET default_profile_id')) {
      const [profileId, updatedAt, userId] = values;
      const user = this.users.get(String(userId));
      if (!user || this.profiles.get(String(profileId))?.user_id !== user.id) return 0;
      this.users.set(user.id, { ...user, default_profile_id: String(profileId), updated_at: Number(updatedAt) });
      return 1;
    }
    if (sql.startsWith('DELETE FROM profiles WHERE id')) {
      const profileId = String(values[0]);
      if (!this.profiles.has(profileId)) return 0;
      this.profiles.delete(profileId);
      for (const [key, token] of this.tokens) if (token.profile_id === profileId) this.tokens.delete(key);
      return 1;
    }
    if (sql.startsWith('UPDATE users SET default_profile_id =')) {
      const [nextDefault, userId] = values;
      const user = this.users.get(String(userId));
      if (!user) return 0;
      this.users.set(user.id, { ...user, default_profile_id: String(nextDefault) });
      return 1;
    }
    return 1;
  }
}

function profile(id: string, userId: string, name: string, createdAt: number): ProfileRecord {
  return {
    id,
    user_id: userId,
    name,
    skin_hash: null,
    cape_hash: null,
    skin_model: 'classic',
    created_at: createdAt,
    updated_at: createdAt,
  };
}

async function createEnvironment() {
  const db = new ProfileDatabase();
  const user: UserRecord = {
    id: 'user-1',
    email: 'player@example.com',
    password: await hashPassword('correct-password', 'salt-1'),
    salt: 'salt-1',
    role: 'user',
    created_at: 1,
    updated_at: 1,
    default_profile_id: 'profile-1',
  };
  db.users.set(user.id, user);
  db.profiles.set('profile-1', profile('profile-1', user.id, 'PlayerOne', 1));
  const env = { DB: db as unknown as D1Database, BUCKET: {}, RATE_LIMITER: createTestRateLimiterNamespace() };
  const response = await app.request('/authserver/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.email, password: 'correct-password', clientToken: 'client-1' }),
  }, env);
  const body = await response.json() as { accessToken: string };
  return { db, env, user, token: body.accessToken };
}

describe('multiple player profiles', () => {
  beforeEach(() => clearLoginFailures());

  it('lists profiles, creates one, renames it, and switches the default', async () => {
    const { db, env, token } = await createEnvironment();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const listed = await app.request('/api/user/profiles', { headers }, env);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      defaultProfileId: 'profile-1',
      profiles: [{ id: 'profile-1', name: 'PlayerOne' }],
    });

    const created = await app.request('/api/user/profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'SecondProfile' }),
    }, env);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { profile: ProfileRecord };
    expect(createdBody.profile).toMatchObject({ name: 'SecondProfile' });
    const secondId = createdBody.profile.id;

    const renamed = await app.request(`/api/user/profiles/${secondId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'RenamedProfile' }),
    }, env);
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({ profile: { id: secondId, name: 'RenamedProfile' } });

    const switched = await app.request(`/api/user/profiles/${secondId}/default`, {
      method: 'PUT',
      headers,
    }, env);
    expect(switched.status).toBe(200);
    await expect(switched.json()).resolves.toMatchObject({ defaultProfileId: secondId });
    expect(db.users.get('user-1')?.default_profile_id).toBe(secondId);

    const current = await app.request('/api/user/profile', { headers }, env);
    await expect(current.json()).resolves.toMatchObject({ user: { profile: { id: secondId, name: 'RenamedProfile' } } });
  });

  it('enforces case-insensitive names, the five-profile quota, ownership, and deletion rules', async () => {
    const { db, env, token } = await createEnvironment();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const duplicate = await app.request('/api/user/profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'playerone' }),
    }, env);
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: 'Conflict', errorCode: 'profile_name_taken' });

    for (const name of ['Second', 'Third', 'Fourth', 'Fifth']) {
      const response = await app.request('/api/user/profiles', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name }),
      }, env);
      expect(response.status).toBe(201);
    }
    const quota = await app.request('/api/user/profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Sixth' }),
    }, env);
    expect(quota.status).toBe(409);
    await expect(quota.json()).resolves.toMatchObject({ error: 'Conflict', errorCode: 'profile_limit_reached' });

    const otherUserId = 'user-2';
    const otherProfileId = 'profile-2';
    db.users.set(otherUserId, {
      id: otherUserId,
      email: 'other@example.com',
      password: await hashPassword('correct-password', 'salt-2'),
      salt: 'salt-2',
      role: 'user',
      created_at: 2,
      updated_at: 2,
      default_profile_id: otherProfileId,
    });
    db.profiles.set(otherProfileId, profile(otherProfileId, otherUserId, 'OtherPlayer', 2));
    const otherLogin = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'other@example.com', password: 'correct-password' }),
    }, env);
    const otherToken = (await otherLogin.json() as { accessToken: string }).accessToken;
    const otherHeaders = { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' };

    const unauthorized = await app.request('/api/user/profiles/profile-1', {
      method: 'PATCH',
      headers: otherHeaders,
      body: JSON.stringify({ name: 'PlayerOneRenamed' }),
    }, env);
    expect(unauthorized.status).toBe(404);
    await expect(unauthorized.json()).resolves.toMatchObject({ errorCode: 'profile_not_found' });

    const firstProfile = db.profiles.get('profile-1')!;
    db.users.set('user-1', { ...db.users.get('user-1')!, default_profile_id: firstProfile.id });
    for (const candidate of [...db.profiles.values()].filter((item) => item.user_id === 'user-1' && item.id !== firstProfile.id)) {
      db.profiles.delete(candidate.id);
    }
    const lastDelete = await app.request('/api/user/profiles/profile-1', {
      method: 'DELETE',
      headers,
    }, env);
    expect(lastDelete.status).toBe(409);
    await expect(lastDelete.json()).resolves.toMatchObject({ errorCode: 'last_profile' });

    const extra = profile('profile-extra', 'user-1', 'ExtraProfile', 100);
    db.profiles.set(extra.id, extra);
    db.users.set('user-1', { ...db.users.get('user-1')!, default_profile_id: extra.id });
    const deleteDefault = await app.request(`/api/user/profiles/${extra.id}`, {
      method: 'DELETE',
      headers,
    }, env);
    expect(deleteDefault.status).toBe(204);
    expect(db.users.get('user-1')?.default_profile_id).toBe('profile-1');
  });

  it('returns every profile from authenticate and allows refresh to select an owned profile only', async () => {
    const { db, env, user, token } = await createEnvironment();
    const second = profile('profile-2', user.id, 'SecondProfile', 2);
    db.profiles.set(second.id, second);

    const authenticate = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.email, password: 'correct-password', clientToken: 'client-2' }),
    }, env);
    const authBody = await authenticate.json() as {
      accessToken: string;
      availableProfiles: Array<{ id: string; name: string }>;
      selectedProfile: { id: string };
    };
    expect(authBody.availableProfiles).toEqual([
      { id: 'profile-1', name: 'PlayerOne' },
      { id: 'profile-2', name: 'SecondProfile' },
    ]);
    expect(authBody.selectedProfile.id).toBe('profile-1');

    const refresh = await app.request('/authserver/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: authBody.accessToken, selectedProfile: { id: second.id } }),
    }, env);
    expect(refresh.status).toBe(200);
    await expect(refresh.json()).resolves.toMatchObject({
      selectedProfile: { id: second.id, name: second.name },
      availableProfiles: authBody.availableProfiles,
    });

    const invalid = await app.request('/authserver/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, selectedProfile: { id: 'profile-foreign' } }),
    }, env);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: 'ForbiddenOperationException',
      errorMessage: 'selectedProfile is invalid.',
    });
  });
});
