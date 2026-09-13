import { Hono } from 'hono';
import type { AppEnv } from '../types';

const routes = new Hono<AppEnv>();
const HASH_PATTERN = /^[0-9a-f]{64}$/i;

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate === etag);
}

routes.get('/textures/:hash', async (c) => {
  const rawHash = c.req.param('hash');
  const normalizedHash = rawHash.toLowerCase();
  const hash = normalizedHash.endsWith('.png') ? normalizedHash.slice(0, -4) : normalizedHash;
  if (!HASH_PATTERN.test(hash)) return c.body(null, 404);

  const object = await c.env.BUCKET.get(`${hash}.png`);
  if (!object?.body) return c.body(null, 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'image/png');
  headers.set('Cache-Control', object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (object.httpEtag && matchesEtag(c.req.header('If-None-Match'), object.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
});

export default routes;
