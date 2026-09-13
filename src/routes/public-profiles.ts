import { Hono } from 'hono';
import type { Context } from 'hono';
import { findProfileById, findPublicProfileByName } from '../db/queries';
import type { AppEnv } from '../types';
import { getPublicBaseUrl } from '../utils/config';
import { serializePublicProfile } from '../utils/serializers';
import { isProfileId } from '../utils/uuid';

const routes = new Hono<AppEnv>();

function profileNotFound(c: Context<AppEnv>): Response {
  return c.body(null, 404);
}

routes.get('/public/profiles/:id', async (c) => {
  const id = c.req.param('id') ?? '';
  if (!isProfileId(id)) return profileNotFound(c);

  const profile = await findProfileById(c.env.DB, id);
  if (!profile) return profileNotFound(c);
  return c.json(serializePublicProfile(profile, getPublicBaseUrl(c)));
});

routes.get('/public/profiles/name/:name', async (c) => {
  const name = c.req.param('name')?.trim() ?? '';
  if (!name) return c.body(null, 204);

  const profile = await findPublicProfileByName(c.env.DB, name);
  if (!profile) return c.body(null, 204);
  return c.json(serializePublicProfile(profile, getPublicBaseUrl(c)));
});

export default routes;
