import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  countTexturesByUserId,
  countTexturesByUserIdAndType,
  countActiveAdministrators,
  countProfilesByUserId,
  deleteAdminUser as deleteAdminUserQuery,
  deleteTextureIfUnreferenced,
  deleteProfile,
  deleteUserTokens,
  findDefaultProfileByUserId,
  findAnyProfileByUserId,
  findTextureByIdForUser,
  findTextureByUserHashAndType,
  findUserByEmail,
  findUserById,
  findProfileByIdForUser,
  findProfileByName,
  findRegistrationInviteById,
  findSiteSettings,
  insertProfileBelowLimit,
  insertRegistrationInvite,
  insertTextureBelowLimit,
  insertWebSession,
  isConstraintViolation,
  listUsers,
  listTextureProfileReferences,
  listTexturesByUserId,
  listProfilesByUserId,
  listRegistrationInvites,
  listAuditLogs,
  findWebSessionById,
  listWebSessions,
  revokeWebSession,
  revokeOtherWebSessions,
  revokeRegistrationInvite,
  revokeUserWebSessions,
  revokeUserAuthSessions,
  rotateWebSession,
  updatePassword,
  updateProfileName,
  updateProfileAsset,
  updateProfileAssetIfTextureExists,
  updateSiteSettings,
  updateTextureName,
  updateUserRole,
  updateUserStatus,
  MAX_PROFILES_PER_USER,
  setDefaultProfile,
} from '../db/queries';
import {
  AUDIT_ACTIONS,
  recordAuditLog,
  requestIdFromRequest,
  sanitizeAuditMetadata,
  type AuditLogEvent,
} from '../audit';
import {
  cacheTextureObject,
  cancelTextureCleanupIfReferenced,
  putTextureObject,
  restoreTextureObject,
  scheduleTextureCleanup,
  TEXTURE_CLEANUP_DELAY_MS,
} from '../texture-cleanup';
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
import {
  serializeAdminUser,
  serializeProfile,
  serializeUser,
  serializeUserWithProfile,
} from '../utils/serializers';
import { normalizePng, type AssetKind } from '../utils/png';
import { generateProfileId, generateUserId } from '../utils/uuid';
import {
  getPublicBaseUrl,
  getTextureUrl,
  getYggdrasilPublicKeyPem,
  isMetadataConfigurationValid,
  isSameOrigin,
  isSkinDomainConfigured,
} from '../utils/config';
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
import type { AppEnv, ProfileRecord, SkinModel, UserRole, WebSessionRecord } from '../types';
import {
  parseInviteInput,
  parseRegistrationSettings,
  type RegistrationSettingsValues,
} from '../utils/registration';
import {
  ADMIN_DEMOTION_CONFIRMATION,
  ADMIN_DISABLE_CONFIRMATION,
  ADMIN_SESSION_REVOKE_CONFIRMATION,
  ADMIN_USER_DELETE_CONFIRMATION,
  parseAdminUserStatus,
} from '../utils/admin';

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
  confirmation?: unknown;
  confirm?: unknown;
  confirmText?: unknown;
}

interface AdminStatusInput {
  status?: unknown;
  confirmation?: unknown;
  confirm?: unknown;
  confirmText?: unknown;
}

interface ProfileNameInput {
  name?: unknown;
}

interface WardrobeApplyInput {
  profileId?: unknown;
}

interface RegistrationSettingsInput {
  registrationMode?: unknown;
  registration_mode?: unknown;
  mode?: unknown;
  maxProfilesPerUser?: unknown;
  max_profiles_per_user?: unknown;
  maxTexturesPerUser?: unknown;
  max_textures_per_user?: unknown;
  enforceJoinIp?: unknown;
  enforce_join_ip?: unknown;
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

async function scheduleIfUnreferenced(c: Context<AppEnv>, hash: string | null): Promise<void> {
  if (!hash) return;
  await scheduleTextureCleanup(c.env.DB, hash);
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

function serializeSiteSettings(record: {
  registration_mode: RegistrationSettingsValues['registrationMode'];
  max_profiles_per_user: number;
  max_textures_per_user: number;
  enforce_join_ip: number;
  created_at: number;
  updated_at: number;
}) {
  return {
    registrationMode: record.registration_mode,
    maxProfilesPerUser: record.max_profiles_per_user,
    maxTexturesPerUser: record.max_textures_per_user,
    enforceJoinIp: record.enforce_join_ip === 1,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function serializeRegistrationInvite(
  invite: {
    id: string;
    code_prefix: string;
    created_by: string;
    use_count: number;
    use_limit: number;
    expires_at: number | null;
    note: string;
    revoked_at: number | null;
    created_at: number;
    updated_at: number;
  },
  code?: string,
) {
  return {
    id: invite.id,
    ...(code ? { code } : {}),
    codePrefix: invite.code_prefix,
    createdBy: invite.created_by,
    useCount: invite.use_count,
    useLimit: invite.use_limit,
    expiresAt: invite.expires_at,
    note: invite.note,
    revokedAt: invite.revoked_at,
    createdAt: invite.created_at,
    updatedAt: invite.updated_at,
  };
}

function serializeAuditMetadata(value: string): Record<string, unknown> {
  try {
    return sanitizeAuditMetadata(JSON.parse(value));
  } catch {
    return {};
  }
}

function serializeAuditLog(log: {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  target_resource: string | null;
  action: string;
  result: 'success' | 'failure';
  request_id: string;
  metadata: string;
  created_at: number;
}) {
  return {
    id: log.id,
    actorUserId: log.actor_user_id,
    targetUserId: log.target_user_id,
    targetResource: log.target_resource,
    action: log.action,
    result: log.result,
    requestId: log.request_id,
    metadata: serializeAuditMetadata(log.metadata),
    createdAt: log.created_at,
  };
}

function validationError(c: Context<AppEnv>, result: { code: string; message: string }): Response {
  return jsonError(c, 400, result.message, 'IllegalArgumentException', result.code);
}

function confirmationValue(body: Record<string, unknown> | null): string | boolean | null {
  if (!body) return null;
  const value = body.confirmation ?? body.confirmText ?? body.confirm;
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' ? value.trim() : null;
}

function requireAdminConfirmation(
  c: Context<AppEnv>,
  body: Record<string, unknown> | null,
  expected: string,
): Response | null {
  const value = confirmationValue(body);
  if (value === true) return null;
  if (value === null || value === '') {
    return jsonError(
      c,
      400,
      `confirmation must be ${expected}.`,
      'IllegalArgumentException',
      'confirmation_required',
    );
  }
  if (value !== expected) {
    return jsonError(
      c,
      400,
      `confirmation must be ${expected}.`,
      'IllegalArgumentException',
      'invalid_confirmation',
    );
  }
  return null;
}

function adminUserNotFound(c: Context<AppEnv>): Response {
  return jsonError(c, 404, 'User not found.', 'NotFound', 'user_not_found');
}

async function writeAudit(
  c: Context<AppEnv>,
  event: Omit<AuditLogEvent, 'requestId'> & { requestId?: string | null },
): Promise<void> {
  await recordAuditLog(c.env.DB, {
    ...event,
    requestId: event.requestId ?? requestIdFromRequest(c.req.raw),
  });
}

function adminGuardError(c: Context<AppEnv>, targetId: string, actorId: string): Response {
  return jsonError(
    c,
    409,
    targetId === actorId
      ? 'You must keep another active administrator before locking your account.'
      : 'The last active administrator cannot be removed.',
    'Conflict',
    targetId === actorId ? 'admin_self_lockout' : 'last_active_admin',
  );
}

async function adminMutationConflict(
  c: Context<AppEnv>,
  targetId: string,
  actorId: string,
): Promise<Response> {
  const target = await findUserById(c.env.DB, targetId);
  if (!target) return adminUserNotFound(c);
  const activeAdmins = await countActiveAdministrators(c.env.DB);
  if (target.role === 'admin' && target.status === 'active' && activeAdmins <= 1) {
    return adminGuardError(c, targetId, actorId);
  }
  return jsonError(c, 409, 'The account changed before this action completed.', 'Conflict', 'account_update_conflict');
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
    await putTextureObject(c.env.BUCKET, key, normalized.bytes);
  }

  if (!reused) {
    await cancelTextureCleanupIfReferenced(c.env.DB, hash);
    try {
      const inserted = await insertTextureBelowLimit(c.env.DB, texture, MAX_TEXTURES_PER_USER);
      if (!inserted) {
        const concurrent = await findTextureByUserHashAndType(c.env.DB, userId, hash, asset);
        if (!concurrent) {
          await scheduleIfUnreferenced(c, hash);
          return textureQuotaReached(c);
        }
        texture = concurrent;
        reused = true;
        if (!isTextureModelCompatible(texture, model ?? profile.skin_model)) {
          return textureModelMismatch(c);
        }
      }
    } catch (error) {
      if (!isConstraintViolation(error)) {
        await scheduleIfUnreferenced(c, hash);
        throw error;
      }
      const concurrent = await findTextureByUserHashAndType(c.env.DB, userId, hash, asset);
      if (!concurrent) {
        await scheduleIfUnreferenced(c, hash);
        throw error;
      }
      texture = concurrent;
      reused = true;
    }
  }

  await cancelTextureCleanupIfReferenced(c.env.DB, hash);

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
    await cancelTextureCleanupIfReferenced(c.env.DB, hash);
    if (previousHash && previousHash !== hash) await scheduleIfUnreferenced(c, previousHash);
  }

  await putTextureObject(c.env.BUCKET, key, normalized.bytes);
  await cancelTextureCleanupIfReferenced(c.env.DB, hash);

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
  await scheduleIfUnreferenced(c, previousHash);
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
  await scheduleIfUnreferenced(c, texture.hash);
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

  const objectKey = `${texture.hash}.png`;
  const cached = await cacheTextureObject(c.env.BUCKET, objectKey);
  if (!cached) return textureNotFound(c);

  const previousHash = assetHash(profile, texture.texture_type);
  await cancelTextureCleanupIfReferenced(c.env.DB, texture.hash);
  const applied = await updateProfileAssetIfTextureExists(
    c.env.DB,
    profile.id,
    c.get('user').id,
    texture.id,
    texture.texture_type,
    texture.hash,
    texture.model ?? profile.skin_model,
  );
  if (!applied) {
    await scheduleIfUnreferenced(c, texture.hash);
    return textureNotFound(c);
  }
  const nextProfile = texture.texture_type === 'skin'
    ? { ...profile, skin_hash: texture.hash, skin_model: texture.model ?? profile.skin_model }
    : { ...profile, cape_hash: texture.hash };
  if (c.get('profile').id === profile.id) c.set('profile', nextProfile);
  await cancelTextureCleanupIfReferenced(c.env.DB, texture.hash);
  await restoreTextureObject(c.env.BUCKET, objectKey, cached);
  await cancelTextureCleanupIfReferenced(c.env.DB, texture.hash);
  if (previousHash && previousHash !== texture.hash) await scheduleIfUnreferenced(c, previousHash);
  return c.json({ texture: serializeTexture(c, texture), profile: serializeProfile(nextProfile) });
}

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
  if (
    !user ||
    !passwordMatches ||
    user.email_verified_at === null ||
    user.status === 'disabled' ||
    user.status === 'pending_deletion'
  ) {
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
  const inserted = await insertWebSession(c.env.DB, session);
  if (!inserted) {
    return jsonError(c, 401, 'Invalid email or password.', 'Unauthorized');
  }

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
  if (
    !user ||
    user.status === 'disabled' ||
    user.status === 'pending_deletion' ||
    !profile
  ) {
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

routes.get('/user/diagnostics', authMiddleware, async (c) => {
  const profile = c.get('profile');
  const settings = await findSiteSettings(c.env.DB);
  let textureAvailable = false;

  if (profile.skin_hash) {
    try {
      textureAvailable = (await c.env.BUCKET.head(`${profile.skin_hash}.png`)) !== null;
    } catch {
      textureAvailable = false;
    }
  }

  const authServerUrl = `${getPublicBaseUrl(c)}/api/yggdrasil`;
  return c.json({
    version: c.env.IMPLEMENTATION_VERSION ?? '0.1.0',
    authServerUrl,
    javaAgentArgument: `-javaagent:authlib-injector.jar=${authServerUrl}`,
    metadataUrl: authServerUrl,
    metadataReachable: isMetadataConfigurationValid(c),
    publicKeyConfigured: Boolean(getYggdrasilPublicKeyPem(c.env)),
    textureDomainConfigured: isSkinDomainConfigured(c),
    profileAvailable: true,
    textureAvailable,
    sameOrigin: isSameOrigin(c),
    ipBindingEnabled: settings?.enforce_join_ip === 1,
    profile: {
      id: profile.id,
      name: profile.name,
      textureUrl: profile.skin_hash ? getTextureUrl(c, profile.skin_hash) : null,
    },
  });
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
  await scheduleIfUnreferenced(c, profile.skin_hash);
  await scheduleIfUnreferenced(c, profile.cape_hash);
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
  await writeAudit(c, {
    actorUserId: user.id,
    targetUserId: user.id,
    targetResource: `user:${user.id}`,
    action: AUDIT_ACTIONS.ACCOUNT_PASSWORD_CHANGE,
    result: 'success',
  });
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

function auditQueryValue(c: Context<AppEnv>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = c.req.query(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function auditTimestamp(value: string | undefined, inclusiveEnd = false): number | undefined | null {
  if (!value) return undefined;
  const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return inclusiveEnd && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parsed + 24 * 60 * 60 * 1000 - 1
    : parsed;
}

routes.get('/admin/audit-logs', authMiddleware, adminMiddleware, async (c) => {
  const rawLimit = Number(c.req.query('limit') ?? '50');
  const rawOffset = Number(c.req.query('offset') ?? '0');
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
  const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
  const action = auditQueryValue(c, 'action');
  const actorUserId = auditQueryValue(c, 'actorUserId', 'actor', 'actor_id', 'actor_user_id');
  const targetUserId = auditQueryValue(c, 'targetUserId', 'target', 'target_id', 'target_user_id');
  const fromCreatedAt = auditTimestamp(auditQueryValue(c, 'from', 'dateFrom', 'start', 'date_from'));
  const toCreatedAt = auditTimestamp(auditQueryValue(c, 'to', 'dateTo', 'end', 'date_to'), true);
  if (fromCreatedAt === null || toCreatedAt === null) {
    return jsonError(c, 400, 'Audit date filters must be timestamps or ISO dates.', 'IllegalArgumentException', 'invalid_audit_date');
  }
  if (fromCreatedAt !== undefined && toCreatedAt !== undefined && fromCreatedAt > toCreatedAt) {
    return jsonError(c, 400, 'The audit start date must be before the end date.', 'IllegalArgumentException', 'invalid_audit_date_range');
  }

  const result = await listAuditLogs(c.env.DB, {
    limit: limit + 1,
    offset,
    action,
    actorUserId,
    targetUserId,
    fromCreatedAt,
    toCreatedAt,
  });
  const logs = result.slice(0, limit);
  return c.json({
    logs: logs.map(serializeAuditLog),
    limit,
    offset,
    hasMore: result.length > limit,
  });
});

routes.put('/admin/users/:id/role', authMiddleware, adminMiddleware, async (c) => {
  const body = await readJson<RoleInput>(c);
  const role = body?.role;
  if (role !== 'user' && role !== 'admin') return jsonError(c, 400, 'role must be user or admin.');
  const userId = c.req.param('id') ?? '';
  const user = await findUserById(c.env.DB, userId);
  if (!user) return adminUserNotFound(c);
  if (role === 'user') {
    const confirmationError = requireAdminConfirmation(
      c,
      body as Record<string, unknown> | null,
      ADMIN_DEMOTION_CONFIRMATION,
    );
    if (confirmationError) return confirmationError;
  }
  const updated = await updateUserRole(c.env.DB, user.id, role as UserRole, Date.now());
  if (!updated) return adminMutationConflict(c, user.id, c.get('user').id);
  const nextUser = await findUserById(c.env.DB, user.id);
  const nextProfile = nextUser ? await findAnyProfileByUserId(c.env.DB, user.id) : null;
  await writeAudit(c, {
    actorUserId: c.get('user').id,
    targetUserId: user.id,
    targetResource: `user:${user.id}`,
    action: AUDIT_ACTIONS.ADMIN_USER_ROLE_UPDATE,
    result: 'success',
    metadata: { fromRole: user.role, toRole: role },
  });
  return c.json({ user: nextUser ? serializeAdminUser(nextUser, nextProfile ?? undefined) : { ...serializeUser(user), role } });
});

async function updateAdminUserStatus(c: Context<AppEnv>): Promise<Response> {
  const body = await readJson<AdminStatusInput>(c);
  const parsed = parseAdminUserStatus(body?.status);
  if (!parsed.ok) return validationError(c, parsed);
  if (parsed.value === 'pending_deletion') {
    return jsonError(
      c,
      400,
      'pending_deletion is managed by the account deletion flow.',
      'IllegalArgumentException',
      'status_transition_not_allowed',
    );
  }

  if (parsed.value === 'disabled') {
    const confirmationError = requireAdminConfirmation(
      c,
      body as Record<string, unknown> | null,
      ADMIN_DISABLE_CONFIRMATION,
    );
    if (confirmationError) return confirmationError;
  }

  const userId = c.req.param('id') ?? '';
  const user = await findUserById(c.env.DB, userId);
  if (!user) return adminUserNotFound(c);
  const updated = await updateUserStatus(c.env.DB, userId, parsed.value, Date.now());
  if (!updated) return adminMutationConflict(c, userId, c.get('user').id);
  if (parsed.value === 'disabled') {
    await revokeUserAuthSessions(c.env.DB, userId, Date.now());
  }
  const nextUser = await findUserById(c.env.DB, userId);
  if (!nextUser) return adminUserNotFound(c);
  const nextProfile = await findAnyProfileByUserId(c.env.DB, userId);
  await writeAudit(c, {
    actorUserId: c.get('user').id,
    targetUserId: userId,
    targetResource: `user:${userId}`,
    action: AUDIT_ACTIONS.ADMIN_USER_STATUS_UPDATE,
    result: 'success',
    metadata: { fromStatus: user.status ?? 'active', toStatus: parsed.value },
  });
  return c.json({ user: serializeAdminUser(nextUser, nextProfile ?? undefined) });
}

async function revokeAdminUserSessions(c: Context<AppEnv>): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(c);
  const confirmationError = requireAdminConfirmation(
    c,
    body,
    ADMIN_SESSION_REVOKE_CONFIRMATION,
  );
  if (confirmationError) return confirmationError;
  const userId = c.req.param('id') ?? '';
  const user = await findUserById(c.env.DB, userId);
  if (!user) return adminUserNotFound(c);
  await revokeUserAuthSessions(c.env.DB, userId, Date.now());
  await writeAudit(c, {
    actorUserId: c.get('user').id,
    targetUserId: userId,
    targetResource: `user:${userId}`,
    action: AUDIT_ACTIONS.ADMIN_USER_SESSIONS_REVOKE,
    result: 'success',
  });
  return c.body(null, 204);
}

async function deleteAdminUserAccount(c: Context<AppEnv>): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(c);
  const confirmationError = requireAdminConfirmation(
    c,
    body,
    ADMIN_USER_DELETE_CONFIRMATION,
  );
  if (confirmationError) return confirmationError;
  const userId = c.req.param('id') ?? '';
  const actor = c.get('user');
  const user = await findUserById(c.env.DB, userId);
  if (!user) return adminUserNotFound(c);
  const now = Date.now();
  let deleted: boolean;
  try {
    deleted = await deleteAdminUserQuery(
      c.env.DB,
      userId,
      now + TEXTURE_CLEANUP_DELAY_MS,
      now,
    );
  } catch (error) {
    if (isConstraintViolation(error)) return adminMutationConflict(c, userId, c.get('user').id);
    throw error;
  }
  if (!deleted) return adminMutationConflict(c, userId, c.get('user').id);
  await writeAudit(c, {
    actorUserId: actor.id === userId ? null : actor.id,
    targetUserId: null,
    targetResource: `user:${userId}`,
    action: AUDIT_ACTIONS.ADMIN_USER_DELETE,
    result: 'success',
    metadata: {
      deletedUserId: userId,
      ...(actor.id === userId
        ? { actorSnapshot: { id: actor.id, email: actor.email, role: actor.role } }
        : {}),
    },
  });
  return c.body(null, 204);
}

routes.patch('/admin/users/:id/status', authMiddleware, adminMiddleware, updateAdminUserStatus);
routes.put('/admin/users/:id/status', authMiddleware, adminMiddleware, updateAdminUserStatus);
routes.delete('/admin/users/:id/sessions', authMiddleware, adminMiddleware, revokeAdminUserSessions);
routes.post('/admin/users/:id/sessions/revoke', authMiddleware, adminMiddleware, revokeAdminUserSessions);
routes.delete('/admin/users/:id', authMiddleware, adminMiddleware, deleteAdminUserAccount);

async function adminSettings(c: Context<AppEnv>): Promise<Response> {
  const record = await findSiteSettings(c.env.DB);
  if (!record) {
    return jsonError(c, 500, 'Registration settings are not initialized.', 'InternalServerError', 'internal_server_error');
  }
  return c.json({ settings: serializeSiteSettings(record) });
}

async function updateAdminSettings(c: Context<AppEnv>): Promise<Response> {
  const record = await findSiteSettings(c.env.DB);
  if (!record) {
    return jsonError(c, 500, 'Registration settings are not initialized.', 'InternalServerError', 'internal_server_error');
  }
  const body = await readJson<RegistrationSettingsInput>(c);
  const input = body
    ? {
      registrationMode: body.registrationMode ?? body.registration_mode ?? body.mode,
      maxProfilesPerUser: body.maxProfilesPerUser ?? body.max_profiles_per_user,
      maxTexturesPerUser: body.maxTexturesPerUser ?? body.max_textures_per_user,
      enforceJoinIp: body.enforceJoinIp ?? body.enforce_join_ip,
    }
    : null;
  const parsed = parseRegistrationSettings(input, {
    registrationMode: record.registration_mode,
    maxProfilesPerUser: record.max_profiles_per_user,
    maxTexturesPerUser: record.max_textures_per_user,
    enforceJoinIp: record.enforce_join_ip === 1,
  });
  if (!parsed.ok) return validationError(c, parsed);

  const updatedAt = Date.now();
  await updateSiteSettings(c.env.DB, parsed.value, updatedAt);
  const updated = await findSiteSettings(c.env.DB);
  if (!updated) {
    return jsonError(c, 500, 'Registration settings could not be saved.', 'InternalServerError', 'internal_server_error');
  }
  await writeAudit(c, {
    actorUserId: c.get('user').id,
    targetResource: 'site_settings:1',
    action: AUDIT_ACTIONS.ADMIN_SETTINGS_UPDATE,
    result: 'success',
    metadata: {
      previousRegistrationMode: record.registration_mode,
      registrationMode: updated.registration_mode,
      maxProfilesPerUser: updated.max_profiles_per_user,
      maxTexturesPerUser: updated.max_textures_per_user,
      enforceJoinIp: updated.enforce_join_ip === 1,
    },
  });
  if (record.registration_mode !== updated.registration_mode) {
    await writeAudit(c, {
      actorUserId: c.get('user').id,
      targetResource: 'site_settings:1',
      action: AUDIT_ACTIONS.ADMIN_REGISTRATION_MODE_UPDATE,
      result: 'success',
      metadata: {
        from: record.registration_mode,
        to: updated.registration_mode,
      },
    });
  }
  return c.json({ settings: serializeSiteSettings(updated) });
}

routes.get('/admin/settings', authMiddleware, adminMiddleware, adminSettings);
routes.patch('/admin/settings', authMiddleware, adminMiddleware, updateAdminSettings);
routes.put('/admin/settings', authMiddleware, adminMiddleware, updateAdminSettings);

routes.get('/admin/invites', authMiddleware, adminMiddleware, async (c) => {
  const rawLimit = Number(c.req.query('limit') ?? '100');
  const rawOffset = Number(c.req.query('offset') ?? '0');
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 100;
  const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
  const invites = await listRegistrationInvites(c.env.DB, limit, offset);
  return c.json({ invites: invites.map((invite) => serializeRegistrationInvite(invite)) });
});

routes.post('/admin/invites', authMiddleware, adminMiddleware, async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const now = Date.now();
  const parsed = parseInviteInput(body, now);
  if (!parsed.ok) return validationError(c, parsed);

  const code = createOpaqueToken();
  const invite = {
    id: generateUserId(),
    code_hash: await hashSessionToken(code),
    code_prefix: code.slice(0, 8),
    created_by: c.get('user').id,
    use_count: 0,
    use_limit: parsed.value.useLimit,
    expires_at: parsed.value.expiresAt,
    note: parsed.value.note,
    revoked_at: null,
    created_at: now,
    updated_at: now,
  };
  await insertRegistrationInvite(c.env.DB, invite);
  await writeAudit(c, {
    actorUserId: c.get('user').id,
    targetResource: `invite:${invite.id}`,
    action: AUDIT_ACTIONS.ADMIN_INVITE_CREATE,
    result: 'success',
    metadata: {
      useLimit: invite.use_limit,
      hasExpiry: invite.expires_at !== null,
    },
  });
  return c.json({ invite: serializeRegistrationInvite(invite, code) }, 201);
});

async function revokeAdminInvite(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param('id') ?? '';
  const invite = await findRegistrationInviteById(c.env.DB, id);
  if (!invite) return jsonError(c, 404, 'Invite not found.', 'NotFound', 'invite_not_found');
  if (!invite.revoked_at) await revokeRegistrationInvite(c.env.DB, id, Date.now());
  const revoked = await findRegistrationInviteById(c.env.DB, id);
  if (!revoked) return jsonError(c, 404, 'Invite not found.', 'NotFound', 'invite_not_found');
  await writeAudit(c, {
    actorUserId: c.get('user').id,
    targetResource: `invite:${id}`,
    action: AUDIT_ACTIONS.ADMIN_INVITE_REVOKE,
    result: 'success',
  });
  return c.json({ invite: serializeRegistrationInvite(revoked) });
}

routes.post('/admin/invites/:id/revoke', authMiddleware, adminMiddleware, revokeAdminInvite);
routes.put('/admin/invites/:id/revoke', authMiddleware, adminMiddleware, revokeAdminInvite);
routes.delete('/admin/invites/:id', authMiddleware, adminMiddleware, revokeAdminInvite);

export default routes;
