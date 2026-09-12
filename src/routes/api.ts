import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  countAssetReferences,
  deleteUserTokens,
  findUserByEmail,
  findUserById,
  findProfileByUserId,
  insertUserAndProfile,
  insertWebSession,
  isConstraintViolation,
  listUsers,
  findWebSessionById,
  listWebSessions,
  revokeWebSession,
  revokeOtherWebSessions,
  revokeUserWebSessions,
  rotateWebSession,
  updatePassword,
  updateProfileAsset,
  updateUserRole,
} from '../db/queries';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import {
  admitLoginAttempt,
  clearLoginFailuresDistributed,
  getClientKey,
  LOGIN_TURNSTILE_THRESHOLD,
} from '../middleware/ratelimit';
import { createSalt, hashPassword, sha256Hex, timingSafeEqual, verifyPassword } from '../utils/crypto';
import { jsonError, readJson } from '../utils/errors';
import { turnstileTokenFromBody, verifyTurnstileToken } from '../utils/turnstile';
import { serializeProfile, serializeUser, serializeUserWithProfile } from '../utils/serializers';
import { normalizePng, type AssetKind } from '../utils/png';
import { generateProfileId, generateUserId } from '../utils/uuid';
import {
  ACCESS_TOKEN_TTL_MS,
  WEB_SESSION_TTL_MS,
  clearWebSessionCookies,
  createAccessCookieValue,
  createOpaqueToken,
  deviceLabelFromUserAgent,
  getRefreshCookie,
  hashSessionToken,
  parseRefreshCookie,
  setWebSessionCookies,
} from '../utils/session';
import type { AppEnv, ProfileRecord, SkinModel, UserRecord, UserRole, WebSessionRecord } from '../types';

interface RegisterInput {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

interface PasswordInput {
  currentPassword?: unknown;
  newPassword?: unknown;
}

interface WebLoginInput {
  email?: unknown;
  password?: unknown;
  turnstileToken?: unknown;
}

interface RoleInput {
  role?: unknown;
}

type MultipartBody = Record<string, string | File | (string | File)[]>;

const routes = new Hono<AppEnv>();

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asPassword(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidProfileName(name: string): boolean {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}

function skinModel(value: unknown): SkinModel | null {
  return value === 'classic' || value === 'slim' ? value : null;
}

function assetFile(body: MultipartBody, asset: AssetKind): File | null {
  const candidates = asset === 'skin' ? ['file', 'skin'] : ['file', 'cape'];
  for (const field of candidates) {
    const value = body[field];
    if (value instanceof File) return value;
  }
  return null;
}

function assetHash(profile: ProfileRecord, asset: AssetKind): string | null {
  return asset === 'skin' ? profile.skin_hash : profile.cape_hash;
}

async function removeIfUnreferenced(c: Context<AppEnv>, hash: string | null): Promise<void> {
  if (!hash) return;
  if (await countAssetReferences(c.env.DB, hash) === 0) {
    await c.env.BUCKET.delete(`${hash}.png`);
  }
}

async function uploadAsset(c: Context<AppEnv>, asset: AssetKind): Promise<Response> {
  let body: MultipartBody;
  try {
    body = await c.req.parseBody() as MultipartBody;
  } catch {
    return jsonError(c, 400, 'A multipart/form-data body is required.');
  }

  const file = assetFile(body, asset);
  if (!file) return jsonError(c, 400, `${asset} file is required.`);
  if (file.type && file.type !== 'image/png') {
    return jsonError(c, 400, 'Only PNG files are supported.', 'IllegalArgumentException', 'unsupported_format');
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return jsonError(c, 400, 'The uploaded PNG is corrupt or incomplete.', 'IllegalArgumentException', 'corrupt_png');
  }
  const normalized = await normalizePng(bytes, asset);
  if (!normalized.ok) {
    return jsonError(c, 400, normalized.reason, 'IllegalArgumentException', normalized.code);
  }

  const profile = c.get('profile');
  const selectedModel = skinModel(body.skin_model);
  if (asset === 'skin' && body.skin_model !== undefined && !selectedModel) {
    return jsonError(c, 400, 'skin_model must be classic or slim.');
  }
  const model = selectedModel ?? profile.skin_model;

  const hash = await sha256Hex(normalized.bytes);
  const clientHash = asString(body.sha256);
  if (clientHash && !/^[0-9a-f]{64}$/i.test(clientHash)) {
    return jsonError(c, 400, 'sha256 must be a 64-character hexadecimal digest.');
  }
  if (clientHash && clientHash.toLowerCase() !== hash) {
    return jsonError(c, 400, 'The uploaded file hash does not match its contents.');
  }
  const key = `${hash}.png`;
  if (!await c.env.BUCKET.head(key)) {
    await c.env.BUCKET.put(key, normalized.bytes, {
      httpMetadata: {
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }

  const previousHash = assetHash(profile, asset);
  await updateProfileAsset(c.env.DB, profile.id, asset, hash, model);
  if (previousHash && previousHash !== hash) await removeIfUnreferenced(c, previousHash);

  const nextProfile: ProfileRecord = asset === 'skin'
    ? { ...profile, skin_hash: hash, skin_model: model }
    : { ...profile, cape_hash: hash };
  return c.json({
    asset,
    hash,
    profile: serializeProfile(nextProfile),
    dimensions: { ok: true, width: normalized.width, height: normalized.height },
    sourceDimensions: { width: normalized.sourceWidth, height: normalized.sourceHeight },
  }, 201);
}

async function deleteAsset(c: Context<AppEnv>, asset: AssetKind): Promise<Response> {
  const profile = c.get('profile');
  const previousHash = assetHash(profile, asset);
  await updateProfileAsset(c.env.DB, profile.id, asset, null, profile.skin_model);
  await removeIfUnreferenced(c, previousHash);
  return c.body(null, 204);
}

routes.post('/register', async (c) => {
  const body = await readJson<RegisterInput>(c);
  const email = asString(body?.email)?.toLowerCase();
  const password = asPassword(body?.password);
  const name = asString(body?.name);
  if (!email || !password || !name) return jsonError(c, 400, 'email, password and name are required.');
  if (!isValidEmail(email)) return jsonError(c, 400, 'A valid email address is required.');
  if (password.length < 8) return jsonError(c, 400, 'Password must be at least 8 characters.');
  if (password.length > 256) return jsonError(c, 400, 'Password must be 256 characters or fewer.');
  if (!isValidProfileName(name)) return jsonError(c, 400, 'Game name must be 3-16 letters, numbers or underscores.');

  const now = Date.now();
  const salt = createSalt();
  const user: UserRecord = {
    id: generateUserId(),
    email,
    password: await hashPassword(password, salt),
    salt,
    role: 'user',
    created_at: now,
    updated_at: now,
  };
  const profile: ProfileRecord = {
    id: generateProfileId(),
    user_id: user.id,
    name,
    skin_hash: null,
    cape_hash: null,
    skin_model: 'classic',
  };

  try {
    await insertUserAndProfile(c.env.DB, user, profile);
  } catch (error) {
    if (isConstraintViolation(error)) return jsonError(c, 409, 'The email or game name is already in use.', 'Conflict');
    throw error;
  }

  return c.json({ user: serializeUser(user, profile) }, 201);
});

routes.post('/auth/login', async (c) => {
  const body = await readJson<WebLoginInput>(c);
  const email = asString(body?.email)?.toLowerCase();
  const password = asPassword(body?.password);
  if (!email || !password) return jsonError(c, 400, 'email and password are required.');
  if (password.length > 256) return jsonError(c, 400, 'Password must be 256 characters or fewer.');

  const clientKey = getClientKey(c.req.raw);
  const admission = await admitLoginAttempt(c.env, clientKey);
  if (!admission.allowed) {
    return jsonError(c, 429, 'Too many failed login attempts. Try again later.', 'TooManyRequests');
  }

  const priorFailures = Math.max(0, admission.failedCount - 1);
  if (priorFailures >= LOGIN_TURNSTILE_THRESHOLD) {
    const turnstileValid = await verifyTurnstileToken(
      turnstileTokenFromBody(body),
      c.env.TURNSTILE_SECRET_KEY,
      { remoteIp: clientKey === 'unknown' ? undefined : clientKey },
    );
    if (!turnstileValid) {
      return jsonError(c, 401, 'Invalid email or password.', 'Unauthorized');
    }
  }

  const user = await findUserByEmail(c.env.DB, email);
  const passwordMatches = user ? await verifyPassword(password, user.salt, user.password) : false;
  if (!user || !passwordMatches) {
    return jsonError(c, 401, 'Invalid email or password.', 'Unauthorized');
  }

  const profile = await findProfileByUserId(c.env.DB, user.id);
  const secret = c.env.WEB_SESSION_SECRET?.trim();
  if (!profile || !secret) {
    return jsonError(c, 500, 'Web sessions are not configured.', 'InternalServerError', 'internal_server_error');
  }

  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const refreshSecret = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const session: WebSessionRecord = {
    id: sessionId,
    user_id: user.id,
    refresh_token_hash: await hashSessionToken(refreshSecret),
    csrf_token_hash: await hashSessionToken(csrfToken),
    device_label: deviceLabelFromUserAgent(c.req.header('User-Agent')),
    created_at: now,
    last_used_at: now,
    expires_at: now + WEB_SESSION_TTL_MS,
    revoked_at: null,
  };
  await insertWebSession(c.env.DB, session);

  const accessExpiresAt = now + ACCESS_TOKEN_TTL_MS;
  const accessValue = await createAccessCookieValue({ sessionId, userId: user.id, expiresAt: accessExpiresAt }, secret);
  setWebSessionCookies(c, accessValue, `${sessionId}.${refreshSecret}`, csrfToken);
  await clearLoginFailuresDistributed(c.env, clientKey);
  return c.json({ user: serializeUser(user, profile), csrfToken });
});

routes.post('/auth/refresh', async (c) => {
  const secret = c.env.WEB_SESSION_SECRET?.trim();
  const presented = parseRefreshCookie(getRefreshCookie(c));
  const session = secret && presented ? await findWebSessionById(c.env.DB, presented.sessionId) : null;
  if (!secret || !presented || !session || session.revoked_at !== null || session.expires_at <= Date.now()) {
    return jsonError(c, 401, 'The web session is invalid or expired.', 'Unauthorized');
  }

  const presentedHash = await hashSessionToken(presented.secret);
  if (!timingSafeEqual(presentedHash, session.refresh_token_hash)) {
    await revokeWebSession(c.env.DB, session.id, Date.now());
    clearWebSessionCookies(c);
    return jsonError(c, 401, 'The web session is invalid or expired.', 'Unauthorized');
  }

  const csrfToken = c.req.header('X-CSRF-Token')?.trim();
  if (!csrfToken || !timingSafeEqual(await hashSessionToken(csrfToken), session.csrf_token_hash)) {
    return jsonError(c, 403, 'A valid CSRF token is required.', 'Forbidden');
  }

  const user = await findUserById(c.env.DB, session.user_id);
  const profile = await findProfileByUserId(c.env.DB, session.user_id);
  if (!user || !profile) {
    await revokeWebSession(c.env.DB, session.id, Date.now());
    clearWebSessionCookies(c);
    return jsonError(c, 401, 'The web session is invalid or expired.', 'Unauthorized');
  }

  const now = Date.now();
  const nextRefreshSecret = createOpaqueToken();
  const nextCsrfToken = createOpaqueToken();
  const rotated = await rotateWebSession(
    c.env.DB,
    session.id,
    session.refresh_token_hash,
    await hashSessionToken(nextRefreshSecret),
    await hashSessionToken(nextCsrfToken),
    now,
  );
  if (!rotated) {
    await revokeWebSession(c.env.DB, session.id, now);
    clearWebSessionCookies(c);
    return jsonError(c, 401, 'The web session is invalid or expired.', 'Unauthorized');
  }

  const accessValue = await createAccessCookieValue(
    { sessionId: session.id, userId: user.id, expiresAt: now + ACCESS_TOKEN_TTL_MS },
    secret,
  );
  setWebSessionCookies(c, accessValue, `${session.id}.${nextRefreshSecret}`, nextCsrfToken);
  return c.json({ user: serializeUser(user, profile), csrfToken: nextCsrfToken });
});

routes.post('/auth/logout', authMiddleware, async (c) => {
  const session = c.get('webSession');
  if (c.get('authMethod') !== 'cookie' || !session) {
    return jsonError(c, 401, 'A web session is required.', 'Unauthorized');
  }
  await revokeWebSession(c.env.DB, session.id, Date.now());
  clearWebSessionCookies(c);
  return c.body(null, 204);
});

routes.get('/auth/sessions', authMiddleware, async (c) => {
  const sessions = await listWebSessions(c.env.DB, c.get('user').id);
  const currentId = c.get('webSession')?.id;
  return c.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      deviceLabel: session.device_label,
      createdAt: session.created_at,
      lastUsedAt: session.last_used_at,
      current: session.id === currentId,
    })),
  });
});

routes.delete('/auth/sessions', authMiddleware, async (c) => {
  if (c.req.query('scope') !== 'other') return jsonError(c, 400, 'scope must be other.');
  const currentSession = c.get('webSession');
  if (c.get('authMethod') !== 'cookie' || !currentSession) {
    return jsonError(c, 401, 'A web session is required.', 'Unauthorized');
  }
  await revokeOtherWebSessions(c.env.DB, c.get('user').id, currentSession.id, Date.now());
  return c.body(null, 204);
});

routes.delete('/auth/sessions/:id', authMiddleware, async (c) => {
  const session = await findWebSessionById(c.env.DB, c.req.param('id'));
  if (!session || session.user_id !== c.get('user').id) return jsonError(c, 404, 'Session not found.', 'NotFound');
  await revokeWebSession(c.env.DB, session.id, Date.now());
  if (c.get('webSession')?.id === session.id) clearWebSessionCookies(c);
  return c.body(null, 204);
});

routes.get('/user/profile', authMiddleware, (c) => {
  return c.json({ user: serializeUser(c.get('user'), c.get('profile')) });
});

routes.put('/user/password', authMiddleware, async (c) => {
  const body = await readJson<PasswordInput>(c);
  const currentPassword = asPassword(body?.currentPassword);
  const newPassword = asPassword(body?.newPassword);
  if (!currentPassword || !newPassword) return jsonError(c, 400, 'currentPassword and newPassword are required.');
  if (newPassword.length < 8) return jsonError(c, 400, 'Password must be at least 8 characters.');
  if (newPassword.length > 256) return jsonError(c, 400, 'Password must be 256 characters or fewer.');
  const user = c.get('user');
  if (!await verifyPassword(currentPassword, user.salt, user.password)) {
    return jsonError(c, 403, 'The current password is incorrect.', 'Forbidden');
  }

  const salt = createSalt();
  await updatePassword(c.env.DB, user.id, await hashPassword(newPassword, salt), salt, Date.now());
  await deleteUserTokens(c.env.DB, user.id);
  await revokeUserWebSessions(c.env.DB, user.id, Date.now());
  if (c.get('authMethod') === 'cookie') clearWebSessionCookies(c);
  return c.body(null, 204);
});

routes.post('/user/skin', authMiddleware, (c) => uploadAsset(c, 'skin'));
routes.delete('/user/skin', authMiddleware, (c) => deleteAsset(c, 'skin'));
routes.post('/user/cape', authMiddleware, (c) => uploadAsset(c, 'cape'));
routes.delete('/user/cape', authMiddleware, (c) => deleteAsset(c, 'cape'));

routes.get('/admin/users', authMiddleware, adminMiddleware, async (c) => {
  const rawLimit = Number(c.req.query('limit') ?? '100');
  const rawOffset = Number(c.req.query('offset') ?? '0');
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 100;
  const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
  const users = await listUsers(c.env.DB, limit, offset);
  return c.json({ users: users.map(serializeUserWithProfile) });
});

routes.put('/admin/users/:id/role', authMiddleware, adminMiddleware, async (c) => {
  const body = await readJson<RoleInput>(c);
  const role = body?.role;
  if (role !== 'user' && role !== 'admin') return jsonError(c, 400, 'role must be user or admin.');
  const user = await findUserById(c.env.DB, c.req.param('id'));
  if (!user) return jsonError(c, 404, 'User not found.', 'NotFound');
  await updateUserRole(c.env.DB, user.id, role as UserRole, Date.now());
  return c.json({ user: { ...serializeUser(user), role } });
});

export default routes;
