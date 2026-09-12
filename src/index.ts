import { Hono } from 'hono';
import type { AppEnv, Bindings } from './types';
import authRoutes from './routes/auth';
import sessionRoutes from './routes/session';
import textureRoutes from './routes/textures';
import apiRoutes from './routes/api';
import registrationRoutes from './routes/registration';
import accountRoutes from './routes/account';
import { corsMiddleware } from './middleware/cors';
import { securityHeadersMiddleware } from './middleware/security';
import { metadata } from './utils/config';
import { processTextureCleanup } from './texture-cleanup';

export { RateLimiterDurableObject } from './durable-objects/rate-limiter';

export const app = new Hono<AppEnv>();

function isManagementApiPath(path: string): boolean {
  const isYggdrasilPath = path === '/api/yggdrasil' || path.startsWith('/api/yggdrasil/');
  return path === '/api' || (path.startsWith('/api/') && !isYggdrasilPath);
}

app.use('*', securityHeadersMiddleware);
app.use('*', corsMiddleware);
app.get('/', metadata);
app.get('/api/yggdrasil', metadata);
app.get('/api/yggdrasil/', metadata);
app.route('/', authRoutes);
app.route('/api/yggdrasil', authRoutes);
app.route('/', sessionRoutes);
app.route('/api/yggdrasil', sessionRoutes);
app.route('/', textureRoutes);
app.route('/api/yggdrasil', textureRoutes);
app.route('/api', apiRoutes);
app.route('/api/auth', registrationRoutes);
app.route('/api', accountRoutes);

app.onError((error, c) => {
  console.error(error);
  const response = { error: 'InternalServerError', errorMessage: 'Internal server error.' };
  return c.json(
    isManagementApiPath(c.req.path) ? { ...response, errorCode: 'internal_server_error' } : response,
    500,
  );
});

app.notFound((c) => {
  const response = { error: 'NotFound', errorMessage: 'Resource not found.' };
  return c.json(isManagementApiPath(c.req.path) ? { ...response, errorCode: 'not_found' } : response, 404);
});

const worker: ExportedHandler<Bindings> = {
  fetch: app.fetch,
  scheduled: async (_controller, env) => {
    const now = Date.now();
    await env.DB.prepare('DELETE FROM tokens WHERE expires_at < ?').bind(now).run();
    await env.DB.prepare('DELETE FROM server_sessions WHERE expires_at < ?').bind(now).run();
    await processTextureCleanup(env.DB, env.BUCKET, now);
  },
};

export default worker;
