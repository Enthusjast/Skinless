import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { hashPassword } from '../src/utils/crypto';
import { clearLoginFailures } from '../src/middleware/ratelimit';
import { createTestRateLimiterNamespace } from './fixtures/rate-limiter';
import { YGGDRASIL_PRIVATE_KEY_PEM, YGGDRASIL_PUBLIC_KEY_PEM } from './fixtures/yggdrasil-keys';
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

  run(): Promise<{ success: true; meta: { changes: number } }> {
    return Promise.resolve({ success: true, meta: { changes: this.database.run(this.sql, this.values) } });
  }

  execute(): void {
    this.database.run(this.sql, this.values);
  }
}

class FakeD1 {
  public users = new Map<string, UserRecord>();
  public profiles = new Map<string, ProfileRecord>();
  public tokens = new Map<string, TokenRecord>();
  public failTokenIssuance = false;

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql.replace(/\s+/g, ' ').trim());
  }

  batch(statements: FakeD1Statement[]): Promise<unknown[]> {
    return Promise.all(statements.map((statement) => statement.run()));
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

  all(_sql: string, _values: unknown[]): Row[] {
    return [];
  }

  run(sql: string, values: unknown[]): number {
    if (sql.startsWith('INSERT INTO tokens')) {
      if (this.failTokenIssuance) return 0;
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
    } else if (sql.startsWith('DELETE FROM tokens WHERE access_token')) {
      const existed = this.tokens.delete(String(values[0]));
      return existed ? 1 : 0;
    } else if (sql.startsWith('DELETE FROM tokens WHERE user_id')) {
      let changes = 0;
      for (const [key, token] of this.tokens) {
        if (token.user_id === values[0]) {
          this.tokens.delete(key);
          changes += 1;
        }
      }
      return changes;
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

async function createEnv(): Promise<{ db: FakeD1; env: Record<string, unknown> }> {
  const db = new FakeD1();
  db.users.set(user.id, { ...user, password: await hashPassword('correct-password', user.salt) });
  db.profiles.set(profile.id, profile);
  return {
    db,
    env: {
      DB: db,
      BUCKET: {},
      RATE_LIMITER: createTestRateLimiterNamespace(),
      API_BASE_URL: 'https://skin.example.com',
      SKIN_DOMAIN: 'skin.example.com',
      YGGDRASIL_PRIVATE_KEY_PEM,
      YGGDRASIL_PUBLIC_KEY_PEM,
    },
  };
}

describe('Yggdrasil authentication API', () => {
  beforeEach(() => clearLoginFailures());
  afterEach(() => vi.unstubAllGlobals());

  it('serves metadata under the configured API root', async () => {
    const { env } = await createEnv();
    const response = await app.request('/api/yggdrasil/', {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      meta: { implementationName: 'cf-yggdrasil' },
      skinDomains: ['skin.example.com'],
      signaturePublickey: YGGDRASIL_PUBLIC_KEY_PEM,
    });
  });

  it('serves only the configured public key through public-key discovery', async () => {
    const { env } = await createEnv();
    const response = await app.request('/api/publickeys', {}, env);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ yggdrasil: YGGDRASIL_PUBLIC_KEY_PEM });
    expect(body).not.toContain(YGGDRASIL_PRIVATE_KEY_PEM);
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
      body: JSON.stringify({ accessToken: authBody.accessToken, clientToken: 'client-1', requestUser: true }),
    }, env);
    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json() as { accessToken: string; user: { id: string } };
    expect(refreshBody.accessToken).not.toBe(authBody.accessToken);
    expect(refreshBody.user.id).toBe(user.id);
    expect(db.tokens.has(authBody.accessToken)).toBe(false);

    const invalidate = await app.request('/api/yggdrasil/authserver/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: refreshBody.accessToken, clientToken: 'client-1' }),
    }, env);
    expect(invalidate.status).toBe(204);
    expect(db.tokens.size).toBe(0);
  });

  it('returns generic forbidden errors when guarded token issuance is rejected', async () => {
    const { db, env } = await createEnv();
    db.failTokenIssuance = true;

    const response = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.email, password: 'correct-password' }),
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'ForbiddenOperationException',
      errorMessage: 'Invalid credentials. Invalid username or password.',
    });
    expect(db.tokens.size).toBe(0);
  });

  it('returns a generic invalid-token error when guarded token refresh is rejected', async () => {
    const { db, env } = await createEnv();
    const authenticate = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.email, password: 'correct-password' }),
    }, env);
    const accessToken = (await authenticate.json() as { accessToken: string }).accessToken;
    db.failTokenIssuance = true;

    const refresh = await app.request('/authserver/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    }, env);

    expect(refresh.status).toBe(403);
    await expect(refresh.json()).resolves.toEqual({
      error: 'ForbiddenOperationException',
      errorMessage: 'Invalid token.',
    });
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

  it('does not count malformed requests toward the five-attempt window', async () => {
    const { env } = await createEnv();
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.33' };
    const malformedBodies = [
      '{',
      JSON.stringify({ username: user.email }),
      JSON.stringify({ password: 'wrong-password' }),
      JSON.stringify({ username: user.email, password: '' }),
      JSON.stringify({ username: user.email, password: 'x'.repeat(257) }),
    ];

    for (const body of malformedBodies) {
      const response = await app.request('/authserver/authenticate', {
        method: 'POST',
        headers,
        body,
      }, env);
      expect(response.status).toBe(400);
    }

    const valid = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: user.email, password: 'correct-password' }),
    }, env);
    expect(valid.status).toBe(200);
  });

  it('keeps unknown-user failures generic and requires Turnstile after three failures', async () => {
    const first = await createEnv();
    const knownFailure = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.30' },
      body: JSON.stringify({ username: user.email, password: 'wrong-password' }),
    }, first.env);
    const unknownFailure = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.31' },
      body: JSON.stringify({ username: 'missing@example.com', password: 'wrong-password' }),
    }, first.env);
    expect(await knownFailure.json()).toEqual(await unknownFailure.json());

    const second = await createEnv();
    second.env.TURNSTILE_SECRET_KEY = 'turnstile-secret';
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.32' };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await app.request('/authserver/authenticate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ username: user.email, password: 'wrong-password' }),
      }, second.env);
      expect(response.status).toBe(403);
    }

    const missingToken = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: user.email, password: 'correct-password' }),
    }, second.env);
    expect(missingToken.status).toBe(403);
    await expect(missingToken.json()).resolves.toEqual({
      error: 'ForbiddenOperationException',
      errorMessage: 'Invalid credentials. Invalid username or password.',
    });

    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ));
    const validToken = await app.request('/authserver/authenticate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: user.email, password: 'correct-password', turnstileToken: 'valid-token' }),
    }, second.env);
    expect(validToken.status).toBe(200);
  });
});
