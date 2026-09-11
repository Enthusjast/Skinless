import { Hono } from 'hono';
import type { AppEnv } from './types';

export const app = new Hono<AppEnv>();

app.get('/', (c) =>
  c.json({
    meta: {
      serverName: c.env.SERVER_NAME ?? 'Skinless',
      implementationName: 'cf-yggdrasil',
      implementationVersion: c.env.IMPLEMENTATION_VERSION ?? '0.1.0',
    },
  }),
);

app.notFound((c) => c.json({ error: 'NotFound', errorMessage: 'Resource not found.' }, 404));

export default {
  fetch: app.fetch,
  scheduled: async () => undefined,
};
