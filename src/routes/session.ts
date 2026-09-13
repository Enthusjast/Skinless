import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  createServerSession,
  findJoinedProfile,
  findProfileById,
  findPublicProfileByName,
  findPublicProfilesByNames,
  findSiteSettings,
  findTokenContext,
} from '../db/queries';
import { allowUnsignedTextures, getPublicBaseUrl, getYggdrasilPrivateKeyPem } from '../utils/config';
import { readJson, yggError } from '../utils/errors';
import { signRsaSha256 } from '../utils/crypto';
import { createTexturesProperty } from '../utils/textures';
import { isProfileId } from '../utils/uuid';
import { getClientKey } from '../middleware/ratelimit';
import type { AppEnv, ProfileRecord } from '../types';

const routes = new Hono<AppEnv>();
const SERVER_SESSION_TTL_MS = 5 * 60 * 1000;
const PROFILE_LOOKUP_PATH = '/profiles/minecraft';
const API_PROFILE_LOOKUP_PATH = '/api/profiles/minecraft';

interface JoinRequest {
  accessToken?: unknown;
  selectedProfile?: unknown;
  serverId?: unknown;
}

async function profileResponse(c: Context<AppEnv>, profile: ProfileRecord): Promise<Response> {
  const property = createTexturesProperty({
    profileId: profile.id,
    profileName: profile.name,
    skinHash: profile.skin_hash,
    capeHash: profile.cape_hash,
    skinModel: profile.skin_model,
    textureBaseUrl: getPublicBaseUrl(c),
  });
  if (property) {
    const privateKey = getYggdrasilPrivateKeyPem(c.env);
    if (privateKey) property.signature = await signRsaSha256(property.value, privateKey);
    else if (!allowUnsignedTextures(c.env)) throw new Error('Yggdrasil texture signing key is not configured.');
  }
  return c.json({
    id: profile.id,
    name: profile.name,
    properties: property ? [property] : [],
  });
}

function publicProfileResponse(profile: ProfileRecord): { id: string; name: string } {
  return { id: profile.id, name: profile.name };
}

async function lookupProfile(c: Context<AppEnv>): Promise<Response> {
  const name = c.req.param('name')?.trim() ?? '';
  if (!name) return c.body(null, 204);
  const profile = await findPublicProfileByName(c.env.DB, name);
  if (!profile) return c.body(null, 204);
  return c.json(publicProfileResponse(profile));
}

async function lookupProfiles(c: Context<AppEnv>): Promise<Response> {
  const body = await readJson<unknown>(c);
  if (!Array.isArray(body) || body.length > 10 || body.some((name) => typeof name !== 'string' || !name.trim())) {
    return yggError(c, 400, 'A JSON array of up to 10 profile names is required.', 'IllegalArgumentException');
  }

  const names = body.map((name) => (name as string).trim());
  const profiles = await findPublicProfilesByNames(c.env.DB, names);
  const byName = new Map(profiles.map((profile) => [profile.name.toLowerCase(), profile]));
  const uniqueNames = [...new Set(names.map((name) => name.toLowerCase()))];
  return c.json(uniqueNames.flatMap((name) => {
    const profile = byName.get(name);
    return profile ? [publicProfileResponse(profile)] : [];
  }));
}

routes.get('/sessionserver/session/minecraft/hasJoined', async (c) => {
  const username = c.req.query('username');
  const serverId = c.req.query('serverId');
  if (!username || serverId === undefined) {
    return yggError(c, 400, 'username and serverId are required.', 'IllegalArgumentException');
  }

  c.header('Cache-Control', 'public, max-age=60');
  const settings = await findSiteSettings(c.env.DB);
  const enforceJoinIp = settings?.enforce_join_ip === 1;
  const requestedIp = c.req.query('ip');
  if (enforceJoinIp && !requestedIp) return c.body(null, 204);
  const profile = await findJoinedProfile(
    c.env.DB,
    serverId,
    username,
    Date.now(),
    enforceJoinIp ? requestedIp : undefined,
  );
  if (!profile) return c.body(null, 204);
  return profileResponse(c, profile);
});

routes.post('/sessionserver/session/minecraft/join', async (c) => {
  const body = await readJson<JoinRequest>(c);
  const accessToken = typeof body?.accessToken === 'string' && body.accessToken.trim() ? body.accessToken.trim() : null;
  const selectedProfile = typeof body?.selectedProfile === 'object' && body.selectedProfile !== null
    ? (body.selectedProfile as { id?: unknown }).id
    : null;
  const profileId = typeof selectedProfile === 'string' && selectedProfile.trim() ? selectedProfile.trim() : null;
  const serverId = typeof body?.serverId === 'string' && body.serverId.length <= 256 ? body.serverId : null;
  if (!accessToken || !profileId || serverId === null) return yggError(c, 400, 'accessToken, selectedProfile.id and serverId are required.');

  const token = await findTokenContext(c.env.DB, accessToken);
  if (!token || token.profile_id !== profileId) return yggError(c, 403, 'Invalid token or selected profile.');

  const now = Date.now();
  const settings = await findSiteSettings(c.env.DB);
  const enforceJoinIp = settings?.enforce_join_ip === 1;
  const created = await createServerSession(c.env.DB, {
    server_id: serverId,
    profile_id: profileId,
    user_id: token.user_id,
    created_at: now,
    expires_at: Math.min(token.expires_at, now + SERVER_SESSION_TTL_MS),
    ip: enforceJoinIp ? getClientKey(c.req.raw) : null,
  });
  if (!created) return yggError(c, 403, 'Invalid token or selected profile.');
  return c.body(null, 204);
});

routes.get('/sessionserver/session/minecraft/profile/:id', async (c) => {
  const id = c.req.param('id');
  if (!isProfileId(id)) return c.body(null, 404);
  const profile = await findProfileById(c.env.DB, id);
  if (!profile) return c.body(null, 404);
  return profileResponse(c, profile);
});

routes.get(`${PROFILE_LOOKUP_PATH}/:name`, lookupProfile);
routes.get(`${API_PROFILE_LOOKUP_PATH}/:name`, lookupProfile);
routes.post(PROFILE_LOOKUP_PATH, lookupProfiles);
routes.post(API_PROFILE_LOOKUP_PATH, lookupProfiles);

export default routes;
