import {
  SELF,
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';

const EMAIL = 'runtime@example.com';
const PASSWORD = 'correct-password';
const PROFILE_NAME = 'RuntimePlayer';
const SKIN_HASH = 'd65260560d5624335d8eef1c12568a08661f665baaa75140c134d40b71600660';
const SKIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAJ0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAIDODUBAAAENBzWNAAAAAElFTkSuQmCC';

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

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
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
  it('completes the account, texture, and server join path using D1 and R2', async () => {
    const registerResponse = await jsonRequest('/api/register', {
      email: EMAIL,
      password: PASSWORD,
      name: PROFILE_NAME,
    });

    expect(registerResponse.status).toBe(201);
    const registerBody = await registerResponse.json() as { user: UserResponse };
    expect(registerBody.user).toMatchObject({
      email: EMAIL,
      role: 'user',
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
    expect(userRow).toMatchObject({ id: registerBody.user.id, email: EMAIL, role: 'user' });
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
    expect(new Uint8Array(await storedSkin!.arrayBuffer())).toEqual(skinBytes);

    const textureResponse = await SELF.fetch(`https://worker.test/textures/${SKIN_HASH}`);
    expect(textureResponse.status).toBe(200);
    expect(textureResponse.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await textureResponse.arrayBuffer())).toEqual(skinBytes);

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
