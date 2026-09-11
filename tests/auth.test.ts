import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { hashPassword } from '../src/utils/crypto';
import { clearLoginFailures } from '../src/middleware/ratelimit';
import type { ProfileRecord, TokenRecord, UserRecord } from '../src/types';

type Row = Record<string, unknown>;

class FakeD1Statement {
  private values: unknown[] = [];

  public constructor(private readonly database: FakeD1, private readonly sql: string) {}

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

  run(): Promise<{ success: true }> {
    this.database.run(this.sql, this.values);
    return Promise.resolve({ success: true });
  }

  execute(): void {
    this.database.run(this.sql, this.values);
  }
}

class FakeD1 {
  public users = new Map<string, UserRecord>();
  public profiles = new Map<string, ProfileRecord>();
  public tokens = new Map<string, TokenRecord>();

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql.replace(/\s+/g, ' ').trim());
  }

  batch(statements: FakeD1Statement[]): Promise<unknown[]> {
    statements.forEach((statement) => statement.execute());
    return Promise.resolve([]);
  }

  first(sql: string, values: unknown[]): Row | null {
    if (sql.startsWith('SELECT * FROM users WHERE email')) {
      const user = [...this.users.values()].find((candidate) => candidate.email === values[0]);
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
        profile_name: profile.name,
        skin_hash: profile.skin_hash,
        cape_hash: profile.cape_hash,
        skin_model: profile.skin_model,
      };
    }
    return null;
  }

  all(_sql: string, _values: unknown[]): Row[] {
    return [];
  }

  run(sql: string, values: unknown[]): void {
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
    } else if (sql.startsWith('DELETE FROM tokens WHERE access_token')) {
      this.tokens.delete(String(values[0]));
    } else if (sql.startsWith('DELETE FROM tokens WHERE user_id')) {
      for (const [key, token] of this.tokens) {
        if (token.user_id === values[0]) this.tokens.delete(key);
      }
    }
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

async function createEnv(): Promise<{ db: FakeD1; env: Record<string, unknown> }> {
  const db = new FakeD1();
  db.users.set(user.id, { ...user, password: await hashPassword('correct-password', user.salt) });
  db.profiles.set(profile.id, profile);
  return {
    db,
    env: {
      DB: db,
      BUCKET: {},
      API_BASE_URL: 'https://skin.example.com',
      SKIN_DOMAIN: 'skin.example.com',
    },
  };
}

describe('Yggdrasil authentication API', () => {
  beforeEach(() => clearLoginFailures());

  it('serves metadata under the configured API root', async () => {
    const { env } = await createEnv();
    const response = await app.request('/api/yggdrasil/', {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      meta: { implementationName: 'cf-yggdrasil' },
      skinDomains: ['skin.example.com'],
    });
  });

  it('authenticates, validates, rotates, and invalidates a token', async () => {
    const { db, env } = await createEnv();
    const authenticate = await app.request('/api/yggdrasil/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'PLAYER@example.com',
        password: 'correct-password',
        clientToken: 'client-1',
        requestUser: true,
      }),
    }, env);

    expect(authenticate.status).toBe(200);
    const authBody = await authenticate.json() as { accessToken: string; selectedProfile: { id: string }; user: { id: string } };
    expect(authBody.selectedProfile.id).toBe(profile.id);
    expect(authBody.user.id).toBe(user.id);
    expect(db.tokens.size).toBe(1);

    const validate = await app.request('/api/yggdrasil/authserver/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: authBody.accessToken, clientToken: 'client-1' }),
    }, env);
    expect(validate.status).toBe(204);

    const refresh = await app.request('/api/yggdrasil/authserver/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: authBody.accessToken, clientToken: 'client-1' }),
    }, env);
    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json() as { accessToken: string };
    expect(refreshBody.accessToken).not.toBe(authBody.accessToken);
    expect(db.tokens.has(authBody.accessToken)).toBe(false);

    const invalidate = await app.request('/api/yggdrasil/authserver/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: refreshBody.accessToken, clientToken: 'client-1' }),
    }, env);
    expect(invalidate.status).toBe(204);
    expect(db.tokens.size).toBe(0);
  });

  it('returns standard errors for invalid credentials and malformed requests', async () => {
    const { env } = await createEnv();
    const invalid = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'player@example.com', password: 'wrong-password' }),
    }, env);
    expect(invalid.status).toBe(403);
    await expect(invalid.json()).resolves.toMatchObject({ error: 'ForbiddenOperationException' });

    const malformed = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'player@example.com' }),
    }, env);
    expect(malformed.status).toBe(400);
  });
});
