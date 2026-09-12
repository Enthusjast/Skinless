import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
} as const;

export const securityHeadersMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = c.req.header('X-Request-Id')?.trim() || crypto.randomUUID();
  await next();
  c.header('X-Request-Id', requestId);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
};
