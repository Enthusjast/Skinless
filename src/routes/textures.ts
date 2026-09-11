import { Hono } from 'hono';
import type { AppEnv } from '../types';

const routes = new Hono<AppEnv>();
const HASH_PATTERN = /^[0-9a-f]{64}$/i;

routes.get('/textures/:hash', async (c) => {
  const rawHash = c.req.param('hash');
  const hash = rawHash.toLowerCase().endsWith('.png') ? rawHash.slice(0, -4) : rawHash;
  if (!HASH_PATTERN.test(hash)) return c.body(null, 404);

  const object = await c.env.BUCKET.get(`${hash}.png`);
  if (!object?.body) return c.body(null, 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'image/png');
  headers.set('Cache-Control', object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
});

export default routes;
