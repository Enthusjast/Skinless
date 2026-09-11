import { Hono } from 'hono';
import type { AppEnv, Bindings } from './types';
import authRoutes from './routes/auth';
import sessionRoutes from './routes/session';
import textureRoutes from './routes/textures';
import apiRoutes from './routes/api';
import { corsMiddleware } from './middleware/cors';
import { metadata } from './utils/config';

export const app = new Hono<AppEnv>();

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

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: 'InternalServerError', errorMessage: 'Internal server error.' }, 500);
});

app.notFound((c) => c.json({ error: 'NotFound', errorMessage: 'Resource not found.' }, 404));

const worker: ExportedHandler<Bindings> = {
  fetch: app.fetch,
  scheduled: async (_controller, env) => {
    const now = Date.now();
    await env.DB.prepare('DELETE FROM tokens WHERE expires_at < ?').bind(now).run();
    await env.DB.prepare('DELETE FROM server_sessions WHERE expires_at < ?').bind(now).run();
  },
};

export default worker;
