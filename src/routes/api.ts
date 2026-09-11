import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  countAssetReferences,
  deleteUserTokens,
  findUserById,
  insertUserAndProfile,
  isConstraintViolation,
  listUsers,
  updatePassword,
  updateProfileAsset,
  updateUserRole,
} from '../db/queries';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { createSalt, hashPassword, sha256Hex, verifyPassword } from '../utils/crypto';
import { jsonError, readJson } from '../utils/errors';
import { serializeProfile, serializeUser, serializeUserWithProfile } from '../utils/serializers';
import { validatePng, type AssetKind } from '../utils/png';
import { generateProfileId, generateUserId } from '../utils/uuid';
import type { AppEnv, ProfileRecord, SkinModel, UserRecord, UserRole } from '../types';

interface RegisterInput {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

interface PasswordInput {
  currentPassword?: unknown;
  newPassword?: unknown;
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
  if (file.type && file.type !== 'image/png') return jsonError(c, 400, 'Only PNG files are supported.');

  const bytes = await file.arrayBuffer();
  const validation = validatePng(bytes, asset);
  if (!validation.ok) return jsonError(c, 400, validation.reason);

  const profile = c.get('profile');
  const selectedModel = skinModel(body.skin_model);
  if (asset === 'skin' && body.skin_model !== undefined && !selectedModel) {
    return jsonError(c, 400, 'skin_model must be classic or slim.');
  }
  const model = selectedModel ?? profile.skin_model;

  const hash = await sha256Hex(bytes);
  const clientHash = asString(body.sha256);
  if (clientHash && !/^[0-9a-f]{64}$/i.test(clientHash)) {
    return jsonError(c, 400, 'sha256 must be a 64-character hexadecimal digest.');
  }
  if (clientHash && clientHash.toLowerCase() !== hash) {
    return jsonError(c, 400, 'The uploaded file hash does not match its contents.');
  }
  const key = `${hash}.png`;
  if (!await c.env.BUCKET.head(key)) {
    await c.env.BUCKET.put(key, bytes, {
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
  return c.json({ asset, hash, profile: serializeProfile(nextProfile), dimensions: validation }, 201);
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
