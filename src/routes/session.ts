import { Hono } from 'hono';
import type { Context } from 'hono';
import { createServerSession, findJoinedProfile, findProfileById, findTokenContext } from '../db/queries';
import { getPublicBaseUrl } from '../utils/config';
import { readJson, yggError } from '../utils/errors';
import { createTexturesProperty } from '../utils/textures';
import { isProfileId } from '../utils/uuid';
import type { AppEnv, ProfileRecord } from '../types';

const routes = new Hono<AppEnv>();
const SERVER_SESSION_TTL_MS = 5 * 60 * 1000;

interface JoinRequest {
  accessToken?: unknown;
  selectedProfile?: unknown;
  serverId?: unknown;
}

function profileResponse(c: Context<AppEnv>, profile: ProfileRecord): Response {
  const property = createTexturesProperty({
    profileId: profile.id,
    profileName: profile.name,
    skinHash: profile.skin_hash,
    capeHash: profile.cape_hash,
    skinModel: profile.skin_model,
    textureBaseUrl: getPublicBaseUrl(c),
  });
  return c.json({
    id: profile.id,
    name: profile.name,
    properties: property ? [property] : [],
  });
}

routes.get('/sessionserver/session/minecraft/hasJoined', async (c) => {
  const username = c.req.query('username');
  const serverId = c.req.query('serverId');
  if (!username || serverId === undefined) {
    return yggError(c, 400, 'username and serverId are required.', 'IllegalArgumentException');
  }

  c.header('Cache-Control', 'public, max-age=60');
  const profile = await findJoinedProfile(c.env.DB, serverId, username);
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
  await createServerSession(c.env.DB, {
    server_id: serverId,
    profile_id: profileId,
    user_id: token.user_id,
    created_at: now,
    expires_at: Math.min(token.expires_at, now + SERVER_SESSION_TTL_MS),
  });
  return c.body(null, 204);
});

routes.get('/sessionserver/session/minecraft/profile/:id', async (c) => {
  const id = c.req.param('id');
  if (!isProfileId(id)) return c.body(null, 404);
  const profile = await findProfileById(c.env.DB, id);
  if (!profile) return c.body(null, 404);
  return profileResponse(c, profile);
});

export default routes;
