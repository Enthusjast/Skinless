import type { MiddlewareHandler } from 'hono';
import type { AppEnv, TokenRecord } from '../types';
import {
  findDefaultProfileByUserId,
  findTokenContext,
  findUserById,
  findWebSessionById,
  touchWebSession,
} from '../db/queries';
import { hashSessionToken, getAccessCookie, verifyAccessCookieValue } from '../utils/session';
import { timingSafeEqual } from '../utils/crypto';
import { jsonError } from '../utils/errors';

function unauthorized(c: Parameters<MiddlewareHandler<AppEnv>>[0], message: string): Response {
  return jsonError(c, 401, message, 'Unauthorized', 'unauthorized');
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (token) {
    const row = await findTokenContext(c.env.DB, token);
    if (!row) return unauthorized(c, 'The access token is invalid or expired.');

    const user = await findUserById(c.env.DB, row.user_id);
    const profile = await findDefaultProfileByUserId(c.env.DB, row.user_id);
    if (!user || !profile) return unauthorized(c, 'The access token is invalid or expired.');

    const tokenRecord: TokenRecord = {
      access_token: row.access_token,
      client_token: row.client_token,
      user_id: row.user_id,
      profile_id: row.profile_id,
      created_at: row.created_at,
      expires_at: row.expires_at,
    };

    c.set('user', user);
    c.set('profile', profile);
    c.set('token', tokenRecord);
    c.set('authMethod', 'bearer');
    await next();
    return;
  }

  const accessCookie = getAccessCookie(c);
  if (!accessCookie) return unauthorized(c, 'A Bearer access token is required.');
  const secret = c.env.WEB_SESSION_SECRET?.trim();
  const payload = secret ? await verifyAccessCookieValue(accessCookie, secret) : null;
  const session = payload ? await findWebSessionById(c.env.DB, payload.sessionId) : null;
  if (
    !payload ||
    !session ||
    session.user_id !== payload.userId ||
    session.revoked_at !== null ||
    session.expires_at <= Date.now()
  ) {
    return unauthorized(c, 'The web session is invalid or expired.');
  }

  const csrfToken = c.req.header('X-CSRF-Token')?.trim();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (!csrfToken || !timingSafeEqual(await hashSessionToken(csrfToken), session.csrf_token_hash)) {
      return jsonError(c, 403, 'A valid CSRF token is required.', 'Forbidden');
    }
  }

  const user = await findUserById(c.env.DB, session.user_id);
  const profile = await findDefaultProfileByUserId(c.env.DB, session.user_id);
  if (!user || !profile) return unauthorized(c, 'The web session is invalid or expired.');

  const lastUsedAt = Date.now();
  await touchWebSession(c.env.DB, session.id, lastUsedAt);
  c.set('user', user);
  c.set('profile', profile);
  c.set('webSession', { ...session, last_used_at: lastUsedAt });
  c.set('authMethod', 'cookie');
  await next();
};

export const adminMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') {
    return jsonError(c, 403, 'Administrator access is required.', 'Forbidden', 'forbidden');
  }
  await next();
};
