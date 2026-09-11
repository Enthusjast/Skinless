import { Hono } from 'hono';
import type { AppEnv } from './types';
import authRoutes from './routes/auth';
import { corsMiddleware } from './middleware/cors';
import { metadata } from './utils/config';

export const app = new Hono<AppEnv>();

app.use('*', corsMiddleware);
app.get('/', metadata);
app.get('/api/yggdrasil', metadata);
app.get('/api/yggdrasil/', metadata);
app.route('/', authRoutes);
app.route('/api/yggdrasil', authRoutes);

app.notFound((c) => c.json({ error: 'NotFound', errorMessage: 'Resource not found.' }, 404));

export default {
  fetch: app.fetch,
  scheduled: async () => undefined,
};
