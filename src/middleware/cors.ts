import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestOrigin = c.req.header('Origin');
  const configured = (c.env.CORS_ORIGIN ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowAnyOrigin = configured.includes('*') || configured.length === 0;
  const allowedOrigin = allowAnyOrigin
    ? '*'
    : requestOrigin && configured.includes(requestOrigin)
      ? requestOrigin
      : configured[0];

  c.header('Access-Control-Allow-Origin', allowedOrigin);
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Max-Age', '86400');
  if (allowedOrigin !== '*') c.header('Vary', 'Origin');

  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
};
