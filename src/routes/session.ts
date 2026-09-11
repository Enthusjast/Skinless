import { Hono } from 'hono';
import type { Context } from 'hono';
import { findProfileById, findProfileByName } from '../db/queries';
import { getPublicBaseUrl } from '../utils/config';
import { jsonError } from '../utils/errors';
import { createTexturesProperty } from '../utils/textures';
import { isProfileId } from '../utils/uuid';
import type { AppEnv, ProfileRecord } from '../types';

const routes = new Hono<AppEnv>();

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
    return jsonError(c, 400, 'username and serverId are required.');
  }

  const profile = await findProfileByName(c.env.DB, username);
  if (!profile) return c.body(null, 204);
  return profileResponse(c, profile);
});

routes.get('/sessionserver/session/minecraft/profile/:id', async (c) => {
  const id = c.req.param('id');
  if (!isProfileId(id)) return c.body(null, 404);
  const profile = await findProfileById(c.env.DB, id);
  if (!profile) return c.body(null, 404);
  return profileResponse(c, profile);
});

export default routes;
