import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  countAssetReferences,
  countTextureRecordsByHash,
  countTexturesByUserId,
  countTexturesByUserIdAndType,
  countProfilesByUserId,
  deleteTextureIfUnreferenced,
  deleteProfile,
  deleteUserTokens,
  findDefaultProfileByUserId,
  findTextureByIdForUser,
  findTextureByUserHashAndType,
  findUserByEmail,
  findUserById,
  findProfileByIdForUser,
  findProfileByName,
  insertProfileBelowLimit,
  insertTextureBelowLimit,
  insertUserAndProfile,
  insertWebSession,
  isConstraintViolation,
  listUsers,
  listTextureProfileReferences,
  listTexturesByUserId,
  listProfilesByUserId,
  findWebSessionById,
  listWebSessions,
  revokeWebSession,
  revokeOtherWebSessions,
  revokeUserWebSessions,
  rotateWebSession,
  updatePassword,
  updateProfileName,
  updateProfileAsset,
  updateProfileAssetIfTextureExists,
  updateTextureName,
  updateUserRole,
  MAX_PROFILES_PER_USER,
  setDefaultProfile,
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
import { getTextureUrl } from '../utils/config';
import {
  isTextureModelCompatible,
  MAX_TEXTURES_PER_USER,
  parseTextureType,
  parseWardrobePage,
  textureName,
  type TextureWardrobeRecord,
} from '../utils/wardrobe';
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

interface ProfileNameInput {
  name?: unknown;
}

interface WardrobeApplyInput {
  profileId?: unknown;
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

function profileNotFound(c: Context<AppEnv>): Response {
  return jsonError(c, 404, 'Profile not found.', 'NotFound', 'profile_not_found');
}

function profileNameConflict(c: Context<AppEnv>): Response {
  return jsonError(c, 409, 'The game name is already in use.', 'Conflict', 'profile_name_taken');
}

function profileLimitReached(c: Context<AppEnv>): Response {
  return jsonError(c, 409, 'Each account may have up to five profiles.', 'Conflict', 'profile_limit_reached');
}

function lastProfileProtected(c: Context<AppEnv>): Response {
  return jsonError(c, 409, 'The last profile cannot be deleted.', 'Conflict', 'last_profile');
}

async function profileCollection(c: Context<AppEnv>, userId = c.get('user').id) {
  const profiles = await listProfilesByUserId(c.env.DB, userId);
  const currentUser = c.get('user');
  const user = currentUser && userId === currentUser.id ? currentUser : await findUserById(c.env.DB, userId);
  const defaultProfileId = user?.default_profile_id && profiles.some((profile) => profile.id === user.default_profile_id)
    ? user.default_profile_id
    : profiles[0]?.id ?? null;
  return {
    profiles: profiles.map(serializeProfile),
    defaultProfileId,
  };
}

async function profilePayload(c: Context<AppEnv>, profile: ProfileRecord, user = c.get('user')) {
  return {
    profile: serializeProfile(profile),
    ...(await profileCollection(c, user.id)),
  };
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
  const profileReferences = await countAssetReferences(c.env.DB, hash);
  const wardrobeReferences = await countTextureRecordsByHash(c.env.DB, hash);
  if (profileReferences === 0 && wardrobeReferences === 0) {
    await c.env.BUCKET.delete(`${hash}.png`);
  }
}

function textureNotFound(c: Context<AppEnv>): Response {
  return jsonError(c, 404, 'Texture not found.', 'NotFound', 'texture_not_found');
}

function textureQuotaReached(c: Context<AppEnv>): Response {
  return jsonError(c, 409, 'Each account may have up to 50 saved textures.', 'Conflict', 'texture_quota_reached');
}

function textureNameInvalid(c: Context<AppEnv>): Response {
  return jsonError(c, 400, 'Texture name must be 1-64 characters without line breaks.', 'IllegalArgumentException', 'texture_name_invalid');
}

function textureModelMismatch(c: Context<AppEnv>): Response {
  return jsonError(c, 409, 'The texture model does not match the target profile.', 'Conflict', 'texture_model_mismatch');
}

function serializeTexture(c: Context<AppEnv>, texture: TextureWardrobeRecord) {
  return {
    id: texture.id,
    hash: texture.hash,
    type: texture.texture_type,
    name: texture.name,
    model: texture.model,
    width: texture.width,
    height: texture.height,
    size: texture.size,
    createdAt: texture.created_at,
    updatedAt: texture.updated_at,
    previewUrl: getTextureUrl(c, texture.hash),
  };
}

async function wardrobeQuota(c: Context<AppEnv>) {
  return {
    used: await countTexturesByUserId(c.env.DB, c.get('user').id),
    limit: MAX_TEXTURES_PER_USER,
  };
}

async function uploadAsset(
  c: Context<AppEnv>,
  requestedAsset: AssetKind | null,
  applyToDefaultProfile: boolean,
): Promise<Response> {
  let body: MultipartBody;
  try {
    body = await c.req.parseBody() as MultipartBody;
  } catch {
    return jsonError(c, 400, 'A multipart/form-data body is required.');
  }

  const asset = requestedAsset ?? parseTextureType(body.type ?? body.texture_type);
  if (!asset) return jsonError(c, 400, 'type must be skin or cape.', 'IllegalArgumentException', 'invalid_texture_type');

  const file = assetFile(body, asset);
  if (!file) return jsonError(c, 400, `${asset} file is required.`, 'IllegalArgumentException', 'texture_file_required');
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
  const requestedModel = body.model ?? body.skin_model;
  const selectedModel = skinModel(requestedModel);
  if (asset === 'skin' && requestedModel !== undefined && !selectedModel) {
    return jsonError(c, 400, 'model must be classic or slim.', 'IllegalArgumentException', 'invalid_texture_model');
  }
  const model = asset === 'skin' ? (selectedModel ?? profile.skin_model) : null;

  const hash = await sha256Hex(normalized.bytes);
  const clientHash = asString(body.sha256);
  if (clientHash && !/^[0-9a-f]{64}$/i.test(clientHash)) {
    return jsonError(c, 400, 'sha256 must be a 64-character hexadecimal digest.');
  }
  if (clientHash && clientHash.toLowerCase() !== hash) {
    return jsonError(c, 400, 'The uploaded file hash does not match its contents.');
  }

  const name = textureName(body.name, asset);
  if (!name) return textureNameInvalid(c);

  const userId = c.get('user').id;
  let texture = await findTextureByUserHashAndType(c.env.DB, userId, hash, asset);
  let reused = texture !== null;
  if (texture && !isTextureModelCompatible(texture, model ?? profile.skin_model)) {
    return textureModelMismatch(c);
  }

  if (!texture) {
    if (await countTexturesByUserId(c.env.DB, userId) >= MAX_TEXTURES_PER_USER) {
      return textureQuotaReached(c);
    }
    const now = Date.now();
    texture = {
      id: generateProfileId(),
      user_id: userId,
      hash,
      texture_type: asset,
      name,
      model,
      width: normalized.width,
      height: normalized.height,
      size: normalized.bytes.byteLength,
      created_at: now,
      updated_at: now,
    };
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

  if (!reused) {
    try {
      const inserted = await insertTextureBelowLimit(c.env.DB, texture, MAX_TEXTURES_PER_USER);
      if (!inserted) {
        const concurrent = await findTextureByUserHashAndType(c.env.DB, userId, hash, asset);
        if (!concurrent) {
          await removeIfUnreferenced(c, hash);
          return textureQuotaReached(c);
        }
        texture = concurrent;
        reused = true;
        if (!isTextureModelCompatible(texture, model ?? profile.skin_model)) {
          return textureModelMismatch(c);
        }
      }
    } catch (error) {
      if (!isConstraintViolation(error)) throw error;
      const concurrent = await findTextureByUserHashAndType(c.env.DB, userId, hash, asset);
      if (!concurrent) throw error;
      texture = concurrent;
      reused = true;
    }
  }

  let nextProfile = profile;
  if (applyToDefaultProfile) {
    const previousHash = assetHash(profile, asset);
    const applied = await updateProfileAssetIfTextureExists(
      c.env.DB,
      profile.id,
      userId,
      texture.id,
      asset,
      hash,
      texture.model ?? profile.skin_model,
    );
    if (!applied) return textureNotFound(c);
    nextProfile = asset === 'skin'
      ? { ...profile, skin_hash: hash, skin_model: texture.model ?? profile.skin_model }
      : { ...profile, cape_hash: hash };
    if (previousHash && previousHash !== hash) await removeIfUnreferenced(c, previousHash);
  }

  const quota = await wardrobeQuota(c);
  return c.json({
    asset,
    hash,
    profile: serializeProfile(nextProfile),
    texture: serializeTexture(c, texture),
    quota,
    reused,
    dimensions: { ok: true, width: normalized.width, height: normalized.height },
    sourceDimensions: { width: normalized.sourceWidth, height: normalized.sourceHeight },
  }, reused ? 200 : 201);
}

async function deleteAsset(c: Context<AppEnv>, asset: AssetKind): Promise<Response> {
  const profile = c.get('profile');
  const previousHash = assetHash(profile, asset);
  await updateProfileAsset(c.env.DB, profile.id, asset, null, profile.skin_model);
  await removeIfUnreferenced(c, previousHash);
  return c.body(null, 204);
}

async function wardrobeCollection(c: Context<AppEnv>): Promise<Response> {
  const rawType = c.req.query('type') ?? c.req.query('texture_type');
  const textureType = rawType === undefined ? null : parseTextureType(rawType);
  if (rawType !== undefined && !textureType) {
    return jsonError(c, 400, 'type must be skin or cape.', 'IllegalArgumentException', 'invalid_texture_type');
  }
  const { limit, offset } = parseWardrobePage({
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  const userId = c.get('user').id;
  const [textures, total, quota] = await Promise.all([
    listTexturesByUserId(c.env.DB, userId, textureType, limit, offset),
    countTexturesByUserIdAndType(c.env.DB, userId, textureType),
    wardrobeQuota(c),
  ]);
  return c.json({
    textures: textures.map((texture) => serializeTexture(c, texture)),
    total,
    limit,
    offset,
    hasMore: offset + textures.length < total,
    quota,
  });
}

async function renameTexture(c: Context<AppEnv>): Promise<Response> {
  const texture = await findTextureByIdForUser(c.env.DB, c.req.param('id') ?? '', c.get('user').id);
  if (!texture) return textureNotFound(c);
  const body = await readJson<ProfileNameInput>(c);
  if (body?.name === undefined) {
    return jsonError(c, 400, 'name is required.', 'IllegalArgumentException', 'texture_name_required');
  }
  if (typeof body.name === 'string' && !body.name.trim()) return textureNameInvalid(c);
  const name = textureName(body.name, texture.texture_type);
  if (!name) return textureNameInvalid(c);
  const updatedAt = Date.now();
  if (!await updateTextureName(c.env.DB, texture.id, c.get('user').id, name, updatedAt)) {
    return textureNotFound(c);
  }
  return c.json({
    texture: serializeTexture(c, { ...texture, name, updated_at: updatedAt }),
  });
}

async function deleteTexture(c: Context<AppEnv>): Promise<Response> {
  const texture = await findTextureByIdForUser(c.env.DB, c.req.param('id') ?? '', c.get('user').id);
  if (!texture) return textureNotFound(c);
  if (!await deleteTextureIfUnreferenced(c.env.DB, texture)) {
    const currentTexture = await findTextureByIdForUser(c.env.DB, texture.id, c.get('user').id);
    if (!currentTexture) return textureNotFound(c);
    const profiles = await listTextureProfileReferences(c.env.DB, currentTexture);
    if (profiles.length > 0) {
      return c.json({
        error: 'Conflict',
        errorMessage: 'The texture is still applied to one or more profiles.',
        errorCode: 'texture_in_use',
        profiles: profiles.map(({ id, name }) => ({ id, name })),
      }, 409);
    }
    return textureNotFound(c);
  }
  await removeIfUnreferenced(c, texture.hash);
  return c.body(null, 204);
}

async function applyTexture(c: Context<AppEnv>): Promise<Response> {
  const texture = await findTextureByIdForUser(c.env.DB, c.req.param('id') ?? '', c.get('user').id);
  if (!texture) return textureNotFound(c);
  const body = await readJson<WardrobeApplyInput>(c);
  const profileId = asString(body?.profileId);
  const profile = await ownedProfile(c, profileId ?? undefined);
  if (!profile) return profileNotFound(c);
  if (!isTextureModelCompatible(texture, profile)) return textureModelMismatch(c);

  const previousHash = assetHash(profile, texture.texture_type);
  const applied = await updateProfileAssetIfTextureExists(
    c.env.DB,
    profile.id,
    c.get('user').id,
    texture.id,
    texture.texture_type,
    texture.hash,
    texture.model ?? profile.skin_model,
  );
  if (!applied) return textureNotFound(c);
  const nextProfile = texture.texture_type === 'skin'
    ? { ...profile, skin_hash: texture.hash, skin_model: texture.model ?? profile.skin_model }
    : { ...profile, cape_hash: texture.hash };
  if (c.get('profile').id === profile.id) c.set('profile', nextProfile);
  if (previousHash && previousHash !== texture.hash) await removeIfUnreferenced(c, previousHash);
  return c.json({ texture: serializeTexture(c, texture), profile: serializeProfile(nextProfile) });
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
    created_at: now,
    updated_at: now,
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

  const profile = await findDefaultProfileByUserId(c.env.DB, user.id);
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
  return c.json({ user: serializeUser(user, profile), csrfToken, ...(await profileCollection(c, user.id)) });
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
  const profile = await findDefaultProfileByUserId(c.env.DB, session.user_id);
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
  return c.json({
    user: serializeUser(user, profile),
    csrfToken: nextCsrfToken,
    ...(await profileCollection(c, user.id)),
  });
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
  return profileCollection(c).then((profiles) => c.json({
    user: serializeUser(c.get('user'), c.get('profile')),
    ...profiles,
  }));
});

async function ownedProfile(c: Context<AppEnv>, profileId: string | undefined): Promise<ProfileRecord | null> {
  if (!profileId) return null;
  return findProfileByIdForUser(c.env.DB, profileId, c.get('user').id);
}

routes.get('/user/profiles', authMiddleware, async (c) => {
  return c.json(await profileCollection(c));
});

routes.post('/user/profiles', authMiddleware, async (c) => {
  const body = await readJson<ProfileNameInput>(c);
  const name = asString(body?.name);
  if (!name) return jsonError(c, 400, 'name is required.');
  if (!isValidProfileName(name)) return jsonError(c, 400, 'Game name must be 3-16 letters, numbers or underscores.');

  const user = c.get('user');
  if (await countProfilesByUserId(c.env.DB, user.id) >= MAX_PROFILES_PER_USER) {
    return profileLimitReached(c);
  }
  if (await findProfileByName(c.env.DB, name)) return profileNameConflict(c);

  const now = Date.now();
  const profile: ProfileRecord = {
    id: generateProfileId(),
    user_id: user.id,
    name,
    skin_hash: null,
    cape_hash: null,
    skin_model: 'classic',
    created_at: now,
    updated_at: now,
  };
  try {
    if (!await insertProfileBelowLimit(c.env.DB, profile, MAX_PROFILES_PER_USER)) {
      return profileLimitReached(c);
    }
  } catch (error) {
    if (isConstraintViolation(error)) return profileNameConflict(c);
    throw error;
  }
  return c.json(await profilePayload(c, profile), 201);
});

async function renameProfile(c: Context<AppEnv>): Promise<Response> {
  const profile = await ownedProfile(c, c.req.param('id'));
  if (!profile) return profileNotFound(c);
  const body = await readJson<ProfileNameInput>(c);
  const name = asString(body?.name);
  if (!name) return jsonError(c, 400, 'name is required.');
  if (!isValidProfileName(name)) return jsonError(c, 400, 'Game name must be 3-16 letters, numbers or underscores.');

  const existing = await findProfileByName(c.env.DB, name);
  if (existing && existing.id !== profile.id) return profileNameConflict(c);
  const updatedAt = Date.now();
  try {
    await updateProfileName(c.env.DB, profile.id, name, updatedAt);
  } catch (error) {
    if (isConstraintViolation(error)) return profileNameConflict(c);
    throw error;
  }
  const nextProfile = { ...profile, name, updated_at: updatedAt };
  if (c.get('user').default_profile_id === profile.id) c.set('profile', nextProfile);
  return c.json(await profilePayload(c, nextProfile));
}

routes.patch('/user/profiles/:id', authMiddleware, renameProfile);
routes.put('/user/profiles/:id', authMiddleware, renameProfile);

routes.delete('/user/profiles/:id', authMiddleware, async (c) => {
  const profile = await ownedProfile(c, c.req.param('id'));
  if (!profile) return profileNotFound(c);
  const user = c.get('user');
  const profiles = await listProfilesByUserId(c.env.DB, user.id);
  if (profiles.length <= 1) return lastProfileProtected(c);

  const defaultId = user.default_profile_id ?? profiles[0]?.id;
  if (defaultId === profile.id) {
    const nextDefault = profiles.find((candidate) => candidate.id !== profile.id);
    if (!nextDefault || !await setDefaultProfile(c.env.DB, user.id, nextDefault.id, Date.now())) {
      return profileNotFound(c);
    }
    c.set('user', { ...user, default_profile_id: nextDefault.id, updated_at: Date.now() });
    c.set('profile', nextDefault);
  }

  const deleted = await deleteProfile(c.env.DB, profile.id, user.id);
  if (!deleted) return profileNotFound(c);
  await removeIfUnreferenced(c, profile.skin_hash);
  await removeIfUnreferenced(c, profile.cape_hash);
  return c.body(null, 204);
});

async function selectDefaultProfile(c: Context<AppEnv>): Promise<Response> {
  const profile = await ownedProfile(c, c.req.param('id'));
  if (!profile) return profileNotFound(c);
  const user = c.get('user');
  const updatedAt = Date.now();
  if (!await setDefaultProfile(c.env.DB, user.id, profile.id, updatedAt)) return profileNotFound(c);
  const nextUser = { ...user, default_profile_id: profile.id, updated_at: updatedAt };
  c.set('user', nextUser);
  c.set('profile', profile);
  return c.json({ user: serializeUser(nextUser, profile), ...(await profileCollection(c)) });
}

routes.put('/user/profiles/:id/default', authMiddleware, selectDefaultProfile);
routes.post('/user/profiles/:id/default', authMiddleware, selectDefaultProfile);

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

routes.get('/user/wardrobe', authMiddleware, (c) => wardrobeCollection(c));
routes.post('/user/wardrobe', authMiddleware, (c) => uploadAsset(c, null, false));
routes.patch('/user/wardrobe/:id', authMiddleware, renameTexture);
routes.put('/user/wardrobe/:id', authMiddleware, renameTexture);
routes.delete('/user/wardrobe/:id', authMiddleware, deleteTexture);
routes.post('/user/wardrobe/:id/apply', authMiddleware, applyTexture);

routes.post('/user/skin', authMiddleware, (c) => uploadAsset(c, 'skin', true));
routes.delete('/user/skin', authMiddleware, (c) => deleteAsset(c, 'skin'));
routes.post('/user/cape', authMiddleware, (c) => uploadAsset(c, 'cape', true));
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
