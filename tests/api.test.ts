import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { clearLoginFailures } from '../src/middleware/ratelimit';
import { hashPassword } from '../src/utils/crypto';
import type { ProfileRecord, TokenRecord, UserRecord } from '../src/types';
import type { TextureWardrobeRecord } from '../src/utils/wardrobe';

const nonCanonicalModernSkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAa0lEQVR42u3QBwEAIAzAMMb1LxiGD0gdNBG1ZZ4d5dO+HQcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK/Ux1wXYi0EV47N+ssAAAAASUVORK5CYII=',
), (character) => character.charCodeAt(0));
const patternedLegacySkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAh0lEQVR42u3TPRJDYBSF4e8TNKIUm0Ap2X+FEpsIpWj8XTOWYJjJzH1PcRfwnHOtUR57HOchsq1WLYD6BQAAAAAAAAAAAAAAAAAAAACgESB4hjL+htMYrufLMk+3YUavWPrua29dQFFW5vPO/7apumlNlia8AAAAAAAAAAAAAAAAAAAAwBXZAZXrFiFMyE+QAAAAAElFTkSuQmCC',
), (character) => character.charCodeAt(0));
const convertedLegacySkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAY0lEQVR4nO3avRlAQBAE0PObIET/3SBEPxSx353Aew3sxDObEilVdfN8nQEAAAAoaxinUB/Qdn3WPmFe1vx9xbYf2W9EnNf9dQQAAAAAAAAA/i36X1Bk/88t+l9g/wcAACjoBVMXEITIUfc3AAAAAElFTkSuQmCC',
), (character) => character.charCodeAt(0));
const legacySkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAHklEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAADwbiAgAAFXlYP5AAAAAElFTkSuQmCC',
), (character) => character.charCodeAt(0));
const wrongDimensions = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAVklEQVR4nO3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBvAI8AAT4ZY7sAAAAASUVORK5CYII=',
), (character) => character.charCodeAt(0));

function pngFile(bytes: Uint8Array, type = 'image/png'): File {
  return new File([bytes.buffer as ArrayBuffer], 'texture.png', { type });
}

function fakePngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

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

  run(): Promise<{ success: true; meta: { changes: number } }> {
    const changes = this.db.run(this.sql, this.values);
    return Promise.resolve({ success: true, meta: { changes } });
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
  public failServerSessionIssuance = false;
  public textures = new Map<string, TextureWardrobeRecord>();
  public cleanups = new Map<string, { scheduledAt: number }>();

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
    if (sql.startsWith('SELECT * FROM texture_wardrobe WHERE user_id = ? AND hash = ?')) {
      const texture = [...this.textures.values()].find((candidate) =>
        candidate.user_id === values[0]
        && candidate.hash === values[1]
        && candidate.texture_type === values[2],
      );
      return texture ? { ...texture } : null;
    }
    if (sql.startsWith('SELECT * FROM texture_wardrobe WHERE id = ? AND user_id = ?')) {
      const texture = this.textures.get(String(values[0]));
      return texture && texture.user_id === values[1] ? { ...texture } : null;
    }
    if (sql.startsWith('SELECT COUNT(*)') && sql.includes('FROM texture_wardrobe')) {
      if (sql.includes('WHERE hash = ?')) {
        return { count: [...this.textures.values()].filter((texture) => texture.hash === values[0]).length };
      }
      return { count: [...this.textures.values()].filter((texture) => texture.user_id === values[0]).length };
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

  run(sql: string, values: unknown[]): number {
    if (sql.startsWith('INSERT INTO users')) {
      const [id, email, password, salt, role, created_at, updated_at] = values;
      this.users.set(String(id), { id: String(id), email: String(email), password: String(password), salt: String(salt), role: role as UserRecord['role'], created_at: Number(created_at), updated_at: Number(updated_at) });
      return 1;
    } else if (sql.startsWith('INSERT INTO profiles')) {
      const [id, user_id, name, skin_hash, cape_hash, skin_model] = values;
      this.profiles.set(String(id), { id: String(id), user_id: String(user_id), name: String(name), skin_hash: skin_hash as string | null, cape_hash: cape_hash as string | null, skin_model: skin_model as ProfileRecord['skin_model'] });
      return 1;
    } else if (sql.startsWith('INSERT INTO tokens')) {
      const [access_token, client_token, user_id, profile_id, created_at, expires_at] = values;
      this.tokens.set(String(access_token), { access_token: String(access_token), client_token: String(client_token), user_id: String(user_id), profile_id: String(profile_id), created_at: Number(created_at), expires_at: Number(expires_at) });
      return 1;
    } else if (sql.startsWith('INSERT INTO server_sessions')) {
      if (this.failServerSessionIssuance) return 0;
      const [serverId, profileId, userId, _createdAt, expiresAt] = values;
      this.sessions.set(String(serverId), { serverId: String(serverId), profileId: String(profileId), userId: String(userId), expiresAt: Number(expiresAt) });
      return 1;
    } else if (sql.startsWith('INSERT INTO texture_wardrobe')) {
      const [id, userId, hash, textureType, name, model, width, height, size, createdAt, updatedAt, ownerId, limit] = values;
      const duplicate = [...this.textures.values()].some((texture) =>
        texture.user_id === ownerId && texture.hash === hash && texture.texture_type === textureType,
      );
      const count = [...this.textures.values()].filter((texture) => texture.user_id === ownerId).length;
      if (duplicate || count >= Number(limit)) return 0;
      this.textures.set(String(id), {
        id: String(id),
        user_id: String(userId),
        hash: String(hash),
        texture_type: textureType as TextureWardrobeRecord['texture_type'],
        name: String(name),
        model: model as TextureWardrobeRecord['model'],
        width: width as number | null,
        height: height as number | null,
        size: size as number | null,
        created_at: Number(createdAt),
        updated_at: Number(updatedAt),
      });
      return 1;
    } else if (sql.startsWith('UPDATE users SET password')) {
      const [password, salt, updatedAt, userId] = values;
      const user = this.users.get(String(userId));
      if (!user) return 0;
      this.users.set(user.id, { ...user, password: String(password), salt: String(salt), updated_at: Number(updatedAt) });
      return 1;
    } else if (sql.startsWith('UPDATE users SET role')) {
      const [role, updatedAt, userId] = values;
      const user = this.users.get(String(userId));
      if (!user) return 0;
      this.users.set(user.id, { ...user, role: role as UserRecord['role'], updated_at: Number(updatedAt) });
      return 1;
    } else if (sql.startsWith('UPDATE profiles SET skin_hash')) {
      const [hash, model, profileId] = values;
      const profile = this.profiles.get(String(profileId));
      if (!profile) return 0;
      if (sql.includes('EXISTS ( SELECT 1 FROM texture_wardrobe')) {
        const texture = this.textures.get(String(values[4]));
        if (
          profile.user_id !== String(values[3])
          || !texture
          || texture.user_id !== String(values[5])
          || texture.hash !== String(values[6])
          || texture.texture_type !== values[7]
        ) return 0;
      }
      this.profiles.set(profile.id, { ...profile, skin_hash: hash as string | null, skin_model: model as ProfileRecord['skin_model'] });
      return 1;
    } else if (sql.startsWith('UPDATE profiles SET cape_hash')) {
      const [hash, profileId] = values;
      const profile = this.profiles.get(String(profileId));
      if (!profile) return 0;
      if (sql.includes('EXISTS ( SELECT 1 FROM texture_wardrobe')) {
        const texture = this.textures.get(String(values[3]));
        if (
          profile.user_id !== String(values[2])
          || !texture
          || texture.user_id !== String(values[4])
          || texture.hash !== String(values[5])
          || texture.texture_type !== values[6]
        ) return 0;
      }
      this.profiles.set(profile.id, { ...profile, cape_hash: hash as string | null });
      return 1;
    } else if (sql.startsWith('DELETE FROM tokens WHERE user_id')) {
      for (const [key, token] of this.tokens) if (token.user_id === values[0]) this.tokens.delete(key);
      return 1;
    } else if (sql.startsWith('DELETE FROM tokens WHERE access_token')) {
      this.tokens.delete(String(values[0]));
      return 1;
    } else if (sql.startsWith('INSERT INTO texture_cleanup')) {
      const [hash, _objectKey, scheduledAt] = values;
      if (this.cleanups.has(String(hash))) return 0;
      this.cleanups.set(String(hash), { scheduledAt: Number(scheduledAt) });
      return 1;
    } else if (sql.startsWith('DELETE FROM texture_cleanup WHERE hash')) {
      this.cleanups.delete(String(values[0]));
      return 1;
    }
    return 0;
  }
}

class MemoryBucket {
  public files = new Map<string, Uint8Array>();
  public onGet: ((key: string) => void) | undefined;

  async head(key: string): Promise<R2Object | null> {
    return this.files.has(key) ? ({ key } as R2Object) : null;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const bytes = this.files.get(key);
    if (!bytes) return null;
    const snapshot = bytes.slice();
    this.onGet?.(key);
    return { arrayBuffer: async () => snapshot.buffer } as R2ObjectBody;
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

async function registeredClient() {
  const db = new MemoryD1();
  const bucket = new MemoryBucket();
  const env = {
    DB: db as unknown as D1Database,
    BUCKET: bucket as unknown as R2Bucket,
    API_BASE_URL: 'https://skin.example.com',
    SKIN_DOMAIN: 'skin.example.com',
    ENVIRONMENT: 'development',
    YGGDRASIL_ALLOW_UNSIGNED_TEXTURES: 'true',
    YGGDRASIL_PRIVATE_KEY_PEM: undefined as string | undefined,
    YGGDRASIL_PUBLIC_KEY_PEM: undefined as string | undefined,
    IMPLEMENTATION_VERSION: undefined as string | undefined,
  };
  const user: UserRecord = {
    id: 'user-1',
    email: 'player@example.com',
    password: await hashPassword('correct-password', 'fixture-salt'),
    salt: 'fixture-salt',
    role: 'user',
    created_at: 1,
    updated_at: 1,
    default_profile_id: 'profile-1',
    email_verified_at: 1,
    status: 'active',
  };
  db.users.set(user.id, user);
  db.profiles.set('profile-1', {
    id: 'profile-1',
    user_id: user.id,
    name: 'PlayerOne',
    skin_hash: null,
    cape_hash: null,
    skin_model: 'classic',
  });
  const login = await app.request('/authserver/authenticate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'player@example.com', password: 'correct-password', clientToken: 'client-1' }) }, env);
  const loginBody = await login.json() as { accessToken: string };
  return { db, bucket, env, token: loginBody.accessToken };
}

describe('management API', () => {
  beforeEach(() => clearLoginFailures());

  it('registers a user, uploads a skin, and defers R2 cleanup after profile removal', async () => {
    const { db, bucket, env, token } = await registeredClient();
    const mismatchForm = new FormData();
    mismatchForm.set('file', pngFile(nonCanonicalModernSkin));
    mismatchForm.set('sha256', '0'.repeat(64));
    const mismatch = await app.request('/api/user/skin', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: mismatchForm }, env);
    expect(mismatch.status).toBe(400);
    expect(bucket.files.size).toBe(0);

    const form = new FormData();
    form.set('file', pngFile(nonCanonicalModernSkin));
    form.set('skin_model', 'slim');
    const upload = await app.request('/api/user/skin', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }, env);

    expect(upload.status).toBe(201);
    expect(bucket.files.size).toBe(1);
    const uploadBody = await upload.json() as { hash: string; texture: { id: string } };
    expect([...db.profiles.values()][0].skin_model).toBe('slim');

    const joinedProfile = [...db.profiles.values()][0];
    bucket.onGet = () => {
      bucket.files.delete(`${uploadBody.hash}.png`);
      bucket.onGet = undefined;
    };
    const reapply = await app.request(`/api/user/wardrobe/${uploadBody.texture.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ profileId: joinedProfile.id }),
    }, env);
    expect(reapply.status).toBe(200);
    expect(bucket.files.has(`${uploadBody.hash}.png`)).toBe(true);

    const join = await app.request('/sessionserver/session/minecraft/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token, selectedProfile: { id: joinedProfile.id }, serverId: 'smoke-server' }) }, env);
    expect(join.status).toBe(204);
    const hasJoined = await app.request('/sessionserver/session/minecraft/hasJoined?username=PlayerOne&serverId=smoke-server', {}, env);
    expect(hasJoined.status).toBe(200);

    const profile = await app.request('/api/user/profile', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(profile.status).toBe(200);
    await expect(profile.json()).resolves.toMatchObject({ user: { profile: { skinModel: 'slim' } } });

    const remove = await app.request('/api/user/skin', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, env);
    expect(remove.status).toBe(204);
    expect(bucket.files.size).toBe(1);
    expect(db.cleanups.size).toBe(0);
  });

  it('returns a generic forbidden error when server-session issuance is rejected', async () => {
    const { db, env, token } = await registeredClient();
    db.failServerSessionIssuance = true;

    const response = await app.request('/sessionserver/session/minecraft/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: token,
        selectedProfile: { id: 'profile-1' },
        serverId: 'guarded-server',
      }),
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'ForbiddenOperationException',
      errorMessage: 'Invalid token or selected profile.',
    });
    expect(db.sessions.size).toBe(0);
  });

  it('rejects unsupported formats, invalid dimensions, fake headers, and truncated PNGs with stable codes', async () => {
    const { bucket, env, token } = await registeredClient();
    const cases: Array<{ bytes: Uint8Array; type: string; expected: string }> = [
      { bytes: nonCanonicalModernSkin, type: 'image/jpeg', expected: 'unsupported_format' },
      { bytes: wrongDimensions, type: 'image/png', expected: 'invalid_dimensions' },
      { bytes: new Uint8Array(33).fill(0), type: 'image/png', expected: 'unsupported_format' },
      { bytes: fakePngHeader(64, 64), type: 'image/png', expected: 'corrupt_png' },
      { bytes: nonCanonicalModernSkin.slice(0, -8), type: 'image/png', expected: 'corrupt_png' },
    ];

    for (const candidate of cases) {
      const form = new FormData();
      form.set('file', pngFile(candidate.bytes, candidate.type));
      const response = await app.request('/api/user/skin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }, env);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ errorCode: candidate.expected });
    }
    expect(bucket.files.size).toBe(0);
  });

  it('converts legacy skins before hashing and stores the canonical R2 bytes', async () => {
    const { bucket, env, token } = await registeredClient();
    const form = new FormData();
    form.set('file', pngFile(patternedLegacySkin));
    form.set('sha256', '8393c45e10ac66cc5e5236500ce5cfed9c987faa098a69f881408d91f19fde99');

    const response = await app.request('/api/user/skin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, env);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      asset: 'skin',
      hash: '8393c45e10ac66cc5e5236500ce5cfed9c987faa098a69f881408d91f19fde99',
      dimensions: { ok: true, width: 64, height: 64 },
    });
    expect(bucket.files.get('8393c45e10ac66cc5e5236500ce5cfed9c987faa098a69f881408d91f19fde99.png'))
      .toEqual(convertedLegacySkin);
    expect(bucket.files.get('8393c45e10ac66cc5e5236500ce5cfed9c987faa098a69f881408d91f19fde99.png'))
      .not.toEqual(patternedLegacySkin);
  });

  it('accepts a legacy skin when the optional client hash is omitted', async () => {
    const { env, token } = await registeredClient();
    const form = new FormData();
    form.set('file', pngFile(legacySkin));
    const response = await app.request('/api/user/skin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, env);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      dimensions: { ok: true, width: 64, height: 64 },
    });
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

  it('returns safe launcher setup diagnostics only for authenticated users', async () => {
    const { env, token } = await registeredClient();
    env.API_BASE_URL = 'https://diagnostic-user:diagnostic-password@skin.example.com';
    env.YGGDRASIL_PRIVATE_KEY_PEM = 'private-key-must-not-leak';
    env.YGGDRASIL_PUBLIC_KEY_PEM = 'public-key-is-only-a-configuration-fact';
    env.IMPLEMENTATION_VERSION = '2.1.0';

    const unauthenticated = await app.request('/api/user/diagnostics', {}, env);
    expect(unauthenticated.status).toBe(401);

    const response = await app.request(
      '/api/user/diagnostics',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown> & {
      profile: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      version: '2.1.0',
      authServerUrl: 'https://skin.example.com/api/yggdrasil',
      javaAgentArgument: '-javaagent:authlib-injector.jar=https://skin.example.com/api/yggdrasil',
      metadataUrl: 'https://skin.example.com/api/yggdrasil',
      metadataReachable: true,
      publicKeyConfigured: true,
      textureDomainConfigured: true,
      profileAvailable: true,
      textureAvailable: false,
      ipBindingEnabled: false,
      profile: {
        id: 'profile-1',
        name: 'PlayerOne',
        textureUrl: null,
      },
    });
    expect(typeof body.sameOrigin).toBe('boolean');
    expect(JSON.stringify(body)).not.toContain('private-key-must-not-leak');
    expect(JSON.stringify(body)).not.toContain('public-key-is-only-a-configuration-fact');
    expect(JSON.stringify(body)).not.toContain('diagnostic-password');
    expect(JSON.stringify(body)).not.toMatch(/password|token|secret|header|ipAddress/i);
  });
});
