import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestOrigin = c.req.header('Origin');
  if (!requestOrigin) return next();

  const configured = (c.env.CORS_ORIGIN ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowAnyOrigin = configured.includes('*') || configured.length === 0;
  const allowedOrigin = allowAnyOrigin
    ? '*'
    : requestOrigin && configured.includes(requestOrigin)
      ? requestOrigin
      : null;

  if (c.req.method === 'OPTIONS') {
    const requestedMethod = c.req.header('Access-Control-Request-Method')?.toUpperCase();
    const methodAllowed = !requestedMethod || ALLOWED_METHODS.includes(requestedMethod as typeof ALLOWED_METHODS[number]);
    if (allowedOrigin && allowedOrigin !== '*') c.header('Vary', 'Origin');
    if (!allowedOrigin && !allowAnyOrigin) c.header('Vary', 'Origin');
    if (!allowedOrigin || !methodAllowed) return c.body(null, 403);

    c.header('Access-Control-Allow-Origin', allowedOrigin);
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    c.header('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
    c.header('Access-Control-Max-Age', '86400');
    return c.body(null, 204);
  }

  await next();
  if (allowedOrigin && allowedOrigin !== '*') c.header('Vary', 'Origin');
  if (!allowedOrigin && !allowAnyOrigin) c.header('Vary', 'Origin');
  if (allowedOrigin) c.header('Access-Control-Allow-Origin', allowedOrigin);
};
