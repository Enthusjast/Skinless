import {
  applyD1Migrations,
  SELF,
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { registerVerifiedAccount } from './verified-registration-fixture';

const EMAIL = 'runtime@example.com';
const PASSWORD = 'correct-password';
const PROFILE_NAME = 'RuntimePlayer';
const SKIN_HASH = '8d447892b6efbc450beab391a7003090694cfcd0014d20766150112cab1675a0';
const SKIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAJ0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAIDODUBAAAENBzWNAAAAAElFTkSuQmCC';
const CANONICAL_SKIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAJ0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAIB3A0BAAAGP8slRAAAAAElFTkSuQmCC';
const PATTERNED_LEGACY_SKIN_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAh0lEQVR42u3TPRJDYBSF4e8TNKIUm0Ap2X+FEpsIpWj8XTOWYJjJzH1PcRfwnHOtUR57HOchsq1WLYD6BQAAAAAAAAAAAAAAAAAAAACgESB4hjL+htMYrufLMk+3YUavWPrua29dQFFW5vPO/7apumlNlia8AAAAAAAAAAAAAAAAAAAAwBXZAZXrFiFMyE+QAAAAAElFTkSuQmCC';
const CONVERTED_LEGACY_SKIN_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAY0lEQVR4nO3avRlAQBAE0PObIET/3SBEPxSx353Aew3sxDObEilVdfN8nQEAAAAoaxinUB/Qdn3WPmFe1vx9xbYf2W9EnNf9dQQAAAAAAAAA/i36X1Bk/88t+l9g/wcAACjoBVMXEITIUfc3AAAAAElFTkSuQmCC';
const WRONG_DIMENSIONS_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAVklEQVR4nO3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBvAI8AAT4ZY7sAAAAASUVORK5CYII=';

interface ProfileResponse {
  id: string;
  name: string;
  skinHash: string | null;
  capeHash: string | null;
  skinModel: 'classic' | 'slim';
}

interface UserResponse {
  id: string;
  email: string;
  role: 'user' | 'admin';
  profile: ProfileResponse;
}

function jsonRequest(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authenticatedRequest(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return SELF.fetch(`https://worker.test${path}`, { ...init, headers });
}

function authenticatedJsonRequest(
  path: string,
  accessToken: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return authenticatedRequest(path, accessToken, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

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

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function transparentPng(width: number, height: number): Promise<Uint8Array> {
  const raw = new Uint8Array((width * 4 + 1) * height);
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const compressed = new Response(stream.readable).arrayBuffer();
  await writer.write(raw);
  await writer.close();

  const idat = new Uint8Array(await compressed);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
    const bytes = new Uint8Array(data.byteLength + 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, data.byteLength);
    bytes.set(typeBytes, 4);
    bytes.set(data, 8);
    let crc = 0xffffffff;
    for (const value of [...typeBytes, ...data]) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    view.setUint32(data.byteLength + 8, (crc ^ 0xffffffff) >>> 0);
    return bytes;
  };
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array()),
  ];
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
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

describe('Cloudflare runtime integration', () => {
  it('runs the profile migration from legacy D1 data and preserves references', async () => {
    const migrationTable = 'task_11_legacy_migrations';
    await env.DB.exec(`
      DROP TABLE IF EXISTS web_sessions;
      DROP TABLE IF EXISTS server_sessions_migration_backup;
      DROP TABLE IF EXISTS tokens_migration_backup;
      DROP TABLE IF EXISTS server_sessions;
      DROP TABLE IF EXISTS tokens;
      DROP TABLE IF EXISTS profiles_new;
      DROP TABLE IF EXISTS profiles;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS ${migrationTable};
    `);

    const legacyMigrations = env.TEST_MIGRATIONS.filter(({ name }) => name === '0001_init.sql' || name === '0002_web_sessions.sql');
    const profileMigration = env.TEST_MIGRATIONS.filter(({ name }) => name === '0003_multiple_profiles.sql');
    expect(legacyMigrations).toHaveLength(2);
    expect(profileMigration).toHaveLength(1);

    await applyD1Migrations(env.DB, legacyMigrations, migrationTable);

    const firstUserId = 'legacy-user-a';
    const secondUserId = 'legacy-user-b';
    const thirdUserId = 'legacy-user-c';
    const firstProfileId = '11111111111111111111111111111111';
    const secondProfileId = '22222222222222222222222222222222';
    const thirdProfileId = '33333333333333333333333333333333';
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, password, salt, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(firstUserId, 'legacy-a@example.com', 'hash-a', 'salt-a', 'user', 100, 101),
      env.DB.prepare(
        `INSERT INTO users (id, email, password, salt, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(secondUserId, 'legacy-b@example.com', 'hash-b', 'salt-b', 'user', 200, 201),
      env.DB.prepare(
        `INSERT INTO users (id, email, password, salt, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(thirdUserId, 'legacy-c@example.com', 'hash-c', 'salt-c', 'user', 300, 301),
      env.DB.prepare(
        `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(firstProfileId, firstUserId, 'LegacyHero', 'skin-hash-a', 'cape-hash-a', 'classic'),
      env.DB.prepare(
        `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(secondProfileId, secondUserId, 'legacyhero', 'skin-hash-b', null, 'slim'),
      env.DB.prepare(
        `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(thirdProfileId, thirdUserId, 'x000000000000002', 'skin-hash-c', 'cape-hash-c', 'classic'),
      env.DB.prepare(
        `INSERT INTO tokens (access_token, client_token, user_id, profile_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind('legacy-token-a', 'client-a', firstUserId, firstProfileId, 110, 1_000),
      env.DB.prepare(
        `INSERT INTO tokens (access_token, client_token, user_id, profile_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind('legacy-token-b', 'client-b', secondUserId, secondProfileId, 210, 2_000),
      env.DB.prepare(
        `INSERT INTO tokens (access_token, client_token, user_id, profile_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind('legacy-token-c', 'client-c', thirdUserId, thirdProfileId, 310, 3_000),
      env.DB.prepare(
        `INSERT INTO server_sessions (server_id, profile_id, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind('legacy-server-a', firstProfileId, firstUserId, 120, 1_000),
      env.DB.prepare(
        `INSERT INTO server_sessions (server_id, profile_id, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind('legacy-server-b', secondProfileId, secondUserId, 220, 2_000),
      env.DB.prepare(
        `INSERT INTO server_sessions (server_id, profile_id, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind('legacy-server-c', thirdProfileId, thirdUserId, 320, 3_000),
      env.DB.prepare(
        `INSERT INTO web_sessions (id, user_id, refresh_token_hash, csrf_token_hash, device_label, created_at, last_used_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind('legacy-web-session', firstUserId, 'refresh-hash', 'csrf-hash', 'legacy device', 130, 140, 1_000),
    ]);

    await applyD1Migrations(env.DB, profileMigration, migrationTable);

    const profiles = await env.DB.prepare(
      `SELECT id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at
       FROM profiles ORDER BY id`,
    ).all<Record<string, unknown>>();
    expect(profiles.results).toEqual([
      {
        id: firstProfileId,
        user_id: firstUserId,
        name: 'LegacyHero',
        skin_hash: 'skin-hash-a',
        cape_hash: 'cape-hash-a',
        skin_model: 'classic',
        created_at: 100,
        updated_at: 101,
      },
      {
        id: secondProfileId,
        user_id: secondUserId,
        name: 'x000000000000002',
        skin_hash: 'skin-hash-b',
        cape_hash: null,
        skin_model: 'slim',
        created_at: 200,
        updated_at: 201,
      },
      {
        id: thirdProfileId,
        user_id: thirdUserId,
        name: 'x000000000000003',
        skin_hash: 'skin-hash-c',
        cape_hash: 'cape-hash-c',
        skin_model: 'classic',
        created_at: 300,
        updated_at: 301,
      },
    ]);

    const duplicateNames = await env.DB.prepare(
      `SELECT lower(name) AS normalized_name, COUNT(*) AS name_count
       FROM profiles GROUP BY lower(name) HAVING COUNT(*) > 1`,
    ).all<Record<string, unknown>>();
    expect(duplicateNames.results).toEqual([]);

    const users = await env.DB.prepare(
      `SELECT id, email, password, salt, role, created_at, updated_at, default_profile_id
       FROM users ORDER BY id`,
    ).all<Record<string, unknown>>();
    expect(users.results).toEqual([
      {
        id: firstUserId,
        email: 'legacy-a@example.com',
        password: 'hash-a',
        salt: 'salt-a',
        role: 'user',
        created_at: 100,
        updated_at: 101,
        default_profile_id: firstProfileId,
      },
      {
        id: secondUserId,
        email: 'legacy-b@example.com',
        password: 'hash-b',
        salt: 'salt-b',
        role: 'user',
        created_at: 200,
        updated_at: 201,
        default_profile_id: secondProfileId,
      },
      {
        id: thirdUserId,
        email: 'legacy-c@example.com',
        password: 'hash-c',
        salt: 'salt-c',
        role: 'user',
        created_at: 300,
        updated_at: 301,
        default_profile_id: thirdProfileId,
      },
    ]);

    await expect(env.DB.prepare(
      `SELECT access_token, client_token, user_id, profile_id, created_at, expires_at
       FROM tokens ORDER BY access_token`,
    ).all<Record<string, unknown>>()).resolves.toMatchObject({
      results: [
        { access_token: 'legacy-token-a', client_token: 'client-a', user_id: firstUserId, profile_id: firstProfileId, created_at: 110, expires_at: 1_000 },
        { access_token: 'legacy-token-b', client_token: 'client-b', user_id: secondUserId, profile_id: secondProfileId, created_at: 210, expires_at: 2_000 },
        { access_token: 'legacy-token-c', client_token: 'client-c', user_id: thirdUserId, profile_id: thirdProfileId, created_at: 310, expires_at: 3_000 },
      ],
    });
    await expect(env.DB.prepare(
      `SELECT server_id, profile_id, user_id, created_at, expires_at
       FROM server_sessions ORDER BY server_id`,
    ).all<Record<string, unknown>>()).resolves.toMatchObject({
      results: [
        { server_id: 'legacy-server-a', profile_id: firstProfileId, user_id: firstUserId, created_at: 120, expires_at: 1_000 },
        { server_id: 'legacy-server-b', profile_id: secondProfileId, user_id: secondUserId, created_at: 220, expires_at: 2_000 },
        { server_id: 'legacy-server-c', profile_id: thirdProfileId, user_id: thirdUserId, created_at: 320, expires_at: 3_000 },
      ],
    });
    await expect(env.DB.prepare(
      `SELECT id, user_id, refresh_token_hash, csrf_token_hash, device_label, created_at, last_used_at, expires_at, revoked_at
       FROM web_sessions`,
    ).first<Record<string, unknown>>()).resolves.toEqual({
      id: 'legacy-web-session',
      user_id: firstUserId,
      refresh_token_hash: 'refresh-hash',
      csrf_token_hash: 'csrf-hash',
      device_label: 'legacy device',
      created_at: 130,
      last_used_at: 140,
      expires_at: 1_000,
      revoked_at: null,
    });

    await expect(env.DB.prepare(
      `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, 'classic', ?, ?)`,
    ).bind('44444444444444444444444444444444', firstUserId, 'LEGACYHERO', 400, 400).run()).rejects.toThrow();
  });

  it('manages profiles with real D1 and enforces names, quota, ownership, defaults, and deletion', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 6);
    const ownerName = `Owner${suffix}`;
    const registerBody = {
      user: await registerVerifiedAccount(`profiles-${suffix}@example.com`, PASSWORD, ownerName),
    };

    const authenticateResponse = await jsonRequest('/authserver/authenticate', {
      username: `profiles-${suffix}@example.com`,
      password: PASSWORD,
      clientToken: `profiles-client-${suffix}`,
    });
    expect(authenticateResponse.status).toBe(200);
    const accessToken = (await authenticateResponse.json() as { accessToken: string }).accessToken;

    const listResponse = await authenticatedRequest('/api/user/profiles', accessToken);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      defaultProfileId: registerBody.user.profile.id,
      profiles: [{ id: registerBody.user.profile.id, name: ownerName }],
    });

    const duplicateResponse = await authenticatedJsonRequest('/api/user/profiles', accessToken, 'POST', { name: ownerName.toLowerCase() });
    expect(duplicateResponse.status).toBe(409);
    await expect(duplicateResponse.json()).resolves.toMatchObject({ errorCode: 'profile_name_taken' });

    const createdProfileIds: string[] = [];
    for (const name of [`Second${suffix}`, `Third${suffix}`, `Fourth${suffix}`, `Fifth${suffix}`]) {
      const response = await authenticatedJsonRequest('/api/user/profiles', accessToken, 'POST', { name });
      expect(response.status).toBe(201);
      const body = await response.json() as { profile: ProfileResponse };
      createdProfileIds.push(body.profile.id);
    }
    const secondProfileId = createdProfileIds[0];

    const renameConflict = await authenticatedJsonRequest(
      `/api/user/profiles/${secondProfileId}`,
      accessToken,
      'PATCH',
      { name: ownerName.toUpperCase() },
    );
    expect(renameConflict.status).toBe(409);
    await expect(renameConflict.json()).resolves.toMatchObject({ errorCode: 'profile_name_taken' });

    const renamed = await authenticatedJsonRequest(
      `/api/user/profiles/${secondProfileId}`,
      accessToken,
      'PATCH',
      { name: `Renamed${suffix}` },
    );
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({ profile: { id: secondProfileId, name: `Renamed${suffix}` } });

    const quotaResponse = await authenticatedJsonRequest('/api/user/profiles', accessToken, 'POST', { name: `Sixth${suffix}` });
    expect(quotaResponse.status).toBe(409);
    await expect(quotaResponse.json()).resolves.toMatchObject({ errorCode: 'profile_limit_reached' });

    const otherSuffix = crypto.randomUUID().replaceAll('-', '').slice(0, 6);
    const otherUser = {
      user: await registerVerifiedAccount(`other-profiles-${otherSuffix}@example.com`, PASSWORD, `Other${otherSuffix}`),
    };
    const otherAuthenticateResponse = await jsonRequest('/authserver/authenticate', {
      username: `other-profiles-${otherSuffix}@example.com`,
      password: PASSWORD,
    });
    const otherAccessToken = (await otherAuthenticateResponse.json() as { accessToken: string }).accessToken;

    const unauthorizedRename = await authenticatedJsonRequest(
      `/api/user/profiles/${registerBody.user.profile.id}`,
      otherAccessToken,
      'PATCH',
      { name: `Hijacked${otherSuffix}` },
    );
    expect(unauthorizedRename.status).toBe(404);
    await expect(unauthorizedRename.json()).resolves.toMatchObject({ errorCode: 'profile_not_found' });
    expect(otherUser.user.profile.id).not.toBe(registerBody.user.profile.id);

    const selectDefault = await authenticatedJsonRequest(`/api/user/profiles/${secondProfileId}/default`, accessToken, 'PUT');
    expect(selectDefault.status).toBe(200);
    await expect(selectDefault.json()).resolves.toMatchObject({ defaultProfileId: secondProfileId });

    const currentProfile = await authenticatedRequest('/api/user/profile', accessToken);
    await expect(currentProfile.json()).resolves.toMatchObject({ user: { profile: { id: secondProfileId, name: `Renamed${suffix}` } } });

    const deleteDefault = await authenticatedJsonRequest(`/api/user/profiles/${secondProfileId}`, accessToken, 'DELETE');
    expect(deleteDefault.status).toBe(204);
    const afterDefaultDeletion = await authenticatedRequest('/api/user/profiles', accessToken);
    await expect(afterDefaultDeletion.json()).resolves.toMatchObject({
      defaultProfileId: registerBody.user.profile.id,
      profiles: expect.not.arrayContaining([{ id: secondProfileId }]),
    });
    const defaultRow = await env.DB.prepare('SELECT default_profile_id FROM users WHERE id = ?')
      .bind(registerBody.user.id)
      .first<{ default_profile_id: string }>();
    expect(defaultRow).toEqual({ default_profile_id: registerBody.user.profile.id });

    for (const profileId of createdProfileIds.slice(1)) {
      const response = await authenticatedJsonRequest(`/api/user/profiles/${profileId}`, accessToken, 'DELETE');
      expect(response.status).toBe(204);
    }
    const lastDelete = await authenticatedJsonRequest(`/api/user/profiles/${registerBody.user.profile.id}`, accessToken, 'DELETE');
    expect(lastDelete.status).toBe(409);
    await expect(lastDelete.json()).resolves.toMatchObject({ errorCode: 'last_profile' });
  });

  it('completes the account, texture, and server join path using D1 and R2', async () => {
    const registerBody = {
      user: await registerVerifiedAccount(EMAIL, PASSWORD, PROFILE_NAME),
    };
    expect(registerBody.user).toMatchObject({
      email: EMAIL,
      role: 'admin',
      profile: {
        name: PROFILE_NAME,
        skinHash: null,
        capeHash: null,
        skinModel: 'classic',
      },
    });

    const userRow = await env.DB
      .prepare('SELECT id, email, password, role FROM users WHERE id = ?')
      .bind(registerBody.user.id)
      .first<{ id: string; email: string; password: string; role: string }>();
    expect(userRow).toMatchObject({ id: registerBody.user.id, email: EMAIL, role: 'admin' });
    expect(userRow?.password).not.toBe(PASSWORD);

    const profileRow = await env.DB
      .prepare('SELECT id, user_id, name, skin_hash, skin_model FROM profiles WHERE user_id = ?')
      .bind(registerBody.user.id)
      .first<{ id: string; user_id: string; name: string; skin_hash: string | null; skin_model: string }>();
    expect(profileRow).toEqual({
      id: registerBody.user.profile.id,
      user_id: registerBody.user.id,
      name: PROFILE_NAME,
      skin_hash: null,
      skin_model: 'classic',
    });

    const webSessionTable = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'web_sessions'")
      .first<{ name: string }>();
    expect(webSessionTable).toEqual({ name: 'web_sessions' });

    const webLoginResponse = await SELF.fetch('https://worker.test/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(webLoginResponse.status).toBe(200);
    const webLoginBody = await webLoginResponse.json() as { user: UserResponse; csrfToken: string };
    expect(webLoginBody.user).toMatchObject({ id: registerBody.user.id, email: EMAIL, profile: { name: PROFILE_NAME } });

    const webSetCookie = webLoginResponse.headers.get('set-cookie') ?? '';
    const webSessionId = cookieValue(webSetCookie, '__Host-skinless_refresh').split('.')[0];
    const webSessionRow = await env.DB
      .prepare('SELECT id, user_id, refresh_token_hash, csrf_token_hash, device_label, revoked_at FROM web_sessions WHERE id = ?')
      .bind(webSessionId)
      .first<{ id: string; user_id: string; refresh_token_hash: string; csrf_token_hash: string; device_label: string; revoked_at: number | null }>();
    expect(webSessionRow).toMatchObject({
      id: webSessionId,
      user_id: registerBody.user.id,
      device_label: 'Chrome on macOS',
      revoked_at: null,
    });
    expect(webSessionRow?.refresh_token_hash).not.toContain(cookieValue(webSetCookie, '__Host-skinless_refresh'));
    expect(webSessionRow?.csrf_token_hash).not.toBe(webLoginBody.csrfToken);

    const webProfileResponse = await SELF.fetch('https://worker.test/api/user/profile', {
      headers: { Cookie: cookieHeader(webSetCookie) },
    });
    expect(webProfileResponse.status).toBe(200);
    await expect(webProfileResponse.json()).resolves.toMatchObject({
      user: { id: registerBody.user.id, email: EMAIL, profile: { name: PROFILE_NAME } },
    });

    const authenticateResponse = await jsonRequest('/authserver/authenticate', {
      username: EMAIL,
      password: PASSWORD,
      clientToken: 'runtime-client',
      requestUser: true,
    });

    expect(authenticateResponse.status).toBe(200);
    const authenticateBody = await authenticateResponse.json() as {
      accessToken: string;
      clientToken: string;
      selectedProfile: { id: string; name: string };
      user: { id: string };
    };
    expect(authenticateBody).toMatchObject({
      clientToken: 'runtime-client',
      selectedProfile: { id: profileRow?.id, name: PROFILE_NAME },
      user: { id: registerBody.user.id },
    });
    expect(authenticateBody.accessToken).toEqual(expect.any(String));

    const tokenRow = await env.DB
      .prepare('SELECT access_token, client_token, user_id, profile_id FROM tokens WHERE access_token = ?')
      .bind(authenticateBody.accessToken)
      .first<{ access_token: string; client_token: string; user_id: string; profile_id: string }>();
    expect(tokenRow).toEqual({
      access_token: authenticateBody.accessToken,
      client_token: 'runtime-client',
      user_id: registerBody.user.id,
      profile_id: registerBody.user.profile.id,
    });

    const profileResponse = await SELF.fetch('https://worker.test/api/user/profile', {
      headers: { Authorization: `Bearer ${authenticateBody.accessToken}` },
    });
    expect(profileResponse.status).toBe(200);
    await expect(profileResponse.json()).resolves.toMatchObject({
      user: {
        id: registerBody.user.id,
        email: EMAIL,
        profile: { id: registerBody.user.profile.id, name: PROFILE_NAME },
      },
    });

    const skinBytes = decodeBase64(SKIN_PNG_BASE64);
    const canonicalSkinBytes = decodeBase64(CANONICAL_SKIN_PNG_BASE64);
    const skinForm = new FormData();
    skinForm.set('file', new File([skinBytes.buffer as ArrayBuffer], 'skin.png', { type: 'image/png' }));
    skinForm.set('skin_model', 'slim');
    const uploadResponse = await SELF.fetch('https://worker.test/api/user/skin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authenticateBody.accessToken}` },
      body: skinForm,
    });

    expect(uploadResponse.status).toBe(201);
    await expect(uploadResponse.json()).resolves.toMatchObject({
      asset: 'skin',
      hash: SKIN_HASH,
      dimensions: { ok: true, width: 64, height: 64 },
      profile: { id: registerBody.user.profile.id, skinHash: SKIN_HASH, skinModel: 'slim' },
    });

    const updatedProfileRow = await env.DB
      .prepare('SELECT skin_hash, skin_model FROM profiles WHERE id = ?')
      .bind(registerBody.user.profile.id)
      .first<{ skin_hash: string; skin_model: string }>();
    expect(updatedProfileRow).toEqual({ skin_hash: SKIN_HASH, skin_model: 'slim' });

    const skinKey = `${SKIN_HASH}.png`;
    expect(await env.BUCKET.head(skinKey)).not.toBeNull();
    const storedSkin = await env.BUCKET.get(skinKey);
    expect(storedSkin).not.toBeNull();
    expect(new Uint8Array(await storedSkin!.arrayBuffer())).toEqual(canonicalSkinBytes);

    const textureResponse = await SELF.fetch(`https://worker.test/textures/${SKIN_HASH}`);
    expect(textureResponse.status).toBe(200);
    expect(textureResponse.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await textureResponse.arrayBuffer())).toEqual(canonicalSkinBytes);

    const joinResponse = await jsonRequest('/sessionserver/session/minecraft/join', {
      accessToken: authenticateBody.accessToken,
      selectedProfile: { id: registerBody.user.profile.id },
      serverId: 'runtime-server',
    });
    expect(joinResponse.status).toBe(204);

    const sessionRow = await env.DB
      .prepare('SELECT server_id, profile_id, user_id FROM server_sessions WHERE server_id = ?')
      .bind('runtime-server')
      .first<{ server_id: string; profile_id: string; user_id: string }>();
    expect(sessionRow).toEqual({
      server_id: 'runtime-server',
      profile_id: registerBody.user.profile.id,
      user_id: registerBody.user.id,
    });

    const hasJoinedResponse = await SELF.fetch(
      `https://worker.test/sessionserver/session/minecraft/hasJoined?username=${PROFILE_NAME}&serverId=runtime-server`,
    );
    expect(hasJoinedResponse.status).toBe(200);
    const hasJoinedBody = await hasJoinedResponse.json() as {
      id: string;
      name: string;
      properties: Array<{ name: string; value: string }>;
    };
    expect(hasJoinedBody).toMatchObject({ id: registerBody.user.profile.id, name: PROFILE_NAME });
    const texturesProperty = hasJoinedBody.properties.find((property) => property.name === 'textures');
    expect(texturesProperty).toBeDefined();
    expect(JSON.parse(atob(texturesProperty!.value))).toMatchObject({
      profileId: registerBody.user.profile.id,
      profileName: PROFILE_NAME,
      textures: {
        SKIN: {
          url: `http://localhost:8787/textures/${SKIN_HASH}`,
          metadata: { model: 'slim' },
        },
      },
    });
  });

  it('rejects invalid texture inputs, converts legacy skins, and preserves cape resolutions', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
    const email = `texture-${suffix}@example.com`;
    const name = `Texture${suffix}`;
    await registerVerifiedAccount(email, PASSWORD, name);

    const authenticateResponse = await jsonRequest('/authserver/authenticate', {
      username: email,
      password: PASSWORD,
      clientToken: `texture-client-${suffix}`,
    });
    expect(authenticateResponse.status).toBe(200);
    const authenticateBody = await authenticateResponse.json() as { accessToken: string };
    const authorization = { Authorization: `Bearer ${authenticateBody.accessToken}` };

    const rejectedInputs: Array<{ bytes: Uint8Array; type: string; code: string }> = [
      { bytes: decodeBase64(SKIN_PNG_BASE64), type: 'image/jpeg', code: 'unsupported_format' },
      { bytes: decodeBase64(SKIN_PNG_BASE64), type: 'image/webp', code: 'unsupported_format' },
      { bytes: decodeBase64(WRONG_DIMENSIONS_BASE64), type: 'image/png', code: 'invalid_dimensions' },
      { bytes: fakePngHeader(64, 64), type: 'image/png', code: 'corrupt_png' },
      { bytes: decodeBase64(SKIN_PNG_BASE64).slice(0, -8), type: 'image/png', code: 'corrupt_png' },
    ];
    for (const input of rejectedInputs) {
      const form = new FormData();
      form.set('file', pngFile(input.bytes, input.type));
      const response = await SELF.fetch('https://worker.test/api/user/skin', {
        method: 'POST',
        headers: authorization,
        body: form,
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ errorCode: input.code });
    }

    const legacyBytes = decodeBase64(PATTERNED_LEGACY_SKIN_BASE64);
    const legacyForm = new FormData();
    legacyForm.set('file', pngFile(legacyBytes));
    legacyForm.set('sha256', '8393c45e10ac66cc5e5236500ce5cfed9c987faa098a69f881408d91f19fde99');
    const legacyResponse = await SELF.fetch('https://worker.test/api/user/skin', {
      method: 'POST',
      headers: authorization,
      body: legacyForm,
    });
    expect(legacyResponse.status).toBe(201);
    const legacyBody = await legacyResponse.json() as { hash: string; dimensions: { width: number; height: number } };
    expect(legacyBody).toMatchObject({
      hash: '8393c45e10ac66cc5e5236500ce5cfed9c987faa098a69f881408d91f19fde99',
      dimensions: { width: 64, height: 64 },
    });
    const storedLegacy = await env.BUCKET.get(`${legacyBody.hash}.png`);
    expect(new Uint8Array(await storedLegacy!.arrayBuffer())).toEqual(decodeBase64(CONVERTED_LEGACY_SKIN_BASE64));

    const cape64 = await transparentPng(64, 32);
    const cape64Form = new FormData();
    cape64Form.set('file', pngFile(cape64));
    const cape64Response = await SELF.fetch('https://worker.test/api/user/cape', {
      method: 'POST',
      headers: authorization,
      body: cape64Form,
    });
    expect(cape64Response.status).toBe(201);
    const cape64Body = await cape64Response.json() as { hash: string; dimensions: { width: number; height: number } };
    expect(cape64Body.dimensions).toEqual({ ok: true, width: 64, height: 32 });
    const storedCape64 = await env.BUCKET.get(`${cape64Body.hash}.png`);
    expect(pngDimensions(new Uint8Array(await storedCape64!.arrayBuffer()))).toEqual({ width: 64, height: 32 });

    const capeLarge = await transparentPng(1024, 512);
    const capeLargeForm = new FormData();
    capeLargeForm.set('file', pngFile(capeLarge));
    const capeLargeResponse = await SELF.fetch('https://worker.test/api/user/cape', {
      method: 'POST',
      headers: authorization,
      body: capeLargeForm,
    });
    expect(capeLargeResponse.status).toBe(201);
    const capeLargeBody = await capeLargeResponse.json() as { hash: string; dimensions: { width: number; height: number } };
    expect(capeLargeBody.dimensions).toEqual({ ok: true, width: 1024, height: 512 });
    const storedCapeLarge = await env.BUCKET.get(`${capeLargeBody.hash}.png`);
    expect(pngDimensions(new Uint8Array(await storedCapeLarge!.arrayBuffer()))).toEqual({ width: 1024, height: 512 });
  });

  it('deletes only expired tokens and server sessions when scheduled', async () => {
    const now = Date.now();
    const userId = 'scheduled-user';
    const profileId = '0123456789abcdef0123456789abcdef';

    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO users (id, email, password, salt, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(userId, 'scheduled@example.com', 'password-hash', 'salt', 'user', now, now),
      env.DB
        .prepare(
          `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(profileId, userId, 'ScheduledUser', null, null, 'classic'),
      env.DB
        .prepare(
          `INSERT INTO tokens (access_token, client_token, user_id, profile_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind('expired-token', 'expired-client', userId, profileId, now - 60_000, now - 1),
      env.DB
        .prepare(
          `INSERT INTO tokens (access_token, client_token, user_id, profile_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind('live-token', 'live-client', userId, profileId, now, now + 60_000),
      env.DB
        .prepare(
          `INSERT INTO server_sessions (server_id, profile_id, user_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind('expired-server', profileId, userId, now - 60_000, now - 1),
      env.DB
        .prepare(
          `INSERT INTO server_sessions (server_id, profile_id, user_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind('live-server', profileId, userId, now, now + 60_000),
    ]);

    const executionContext = createExecutionContext();
    await worker.scheduled!(
      createScheduledController({ cron: '0 3 * * *', scheduledTime: now }),
      env,
      executionContext,
    );
    await waitOnExecutionContext(executionContext);

    const tokenRows = await env.DB
      .prepare('SELECT access_token FROM tokens ORDER BY access_token')
      .all<{ access_token: string }>();
    expect(tokenRows.results).toEqual([{ access_token: 'live-token' }]);

    const sessionRows = await env.DB
      .prepare('SELECT server_id FROM server_sessions ORDER BY server_id')
      .all<{ server_id: string }>();
    expect(sessionRows.results).toEqual([{ server_id: 'live-server' }]);
  });

  it('uses a real isolated Durable Object for atomic windows and block expiry', async () => {
    if (!env.RATE_LIMITER) throw new Error('RATE_LIMITER binding unavailable in integration pool');

    interface LimitResult {
      allowed: boolean;
      blocked: boolean;
      retryAfter: number;
      failedCount: number;
    }

    const namespace = env.RATE_LIMITER;
    const concurrentStub = namespace.get(namespace.idFromName(`integration-concurrent-${crypto.randomUUID()}`));
    const concurrentConfig = { windowMs: 60 * 60 * 1000, limit: 100, blockMs: 60 * 60 * 1000 };
    const call = async (
      stub: DurableObjectStub,
      input: { action: 'check' | 'record'; now: number; windowMs: number; limit: number; blockMs: number },
    ): Promise<LimitResult> => {
      const response = await stub.fetch('https://rate-limiter.test/limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<LimitResult>;
    };

    const concurrentResults = await Promise.all(
      Array.from({ length: 20 }, (_, index) => call(concurrentStub, {
        action: 'record',
        now: 100_000 + index,
        ...concurrentConfig,
      })),
    );
    expect(concurrentResults.map((result) => result.failedCount).sort((left, right) => left - right)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );

    const blockStub = namespace.get(namespace.idFromName(`integration-block-${crypto.randomUUID()}`));
    const loginConfig = { windowMs: 15 * 60 * 1000, limit: 5, blockMs: 15 * 60 * 1000 };
    for (let index = 0; index < 5; index += 1) {
      await call(blockStub, { action: 'record', now: 200_000 + index, ...loginConfig });
    }
    await expect(call(blockStub, { action: 'check', now: 200_005, ...loginConfig })).resolves.toEqual({
      allowed: false,
      blocked: true,
      retryAfter: loginConfig.blockMs - 1,
      failedCount: 5,
    });
    await expect(call(blockStub, {
      action: 'check',
      now: 200_004 + loginConfig.blockMs,
      ...loginConfig,
    })).resolves.toEqual({ allowed: true, blocked: false, retryAfter: 0, failedCount: 0 });
  });
});
