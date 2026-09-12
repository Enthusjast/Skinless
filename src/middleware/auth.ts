import type { MiddlewareHandler } from 'hono';
import type { AppEnv, ProfileRecord, TokenRecord, UserRecord } from '../types';
import { findTokenContext } from '../db/queries';
import { jsonError } from '../utils/errors';

function unauthorized(c: Parameters<MiddlewareHandler<AppEnv>>[0], message: string): Response {
  return jsonError(c, 401, message, 'Unauthorized', 'unauthorized');
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return unauthorized(c, 'A Bearer access token is required.');

  const row = await findTokenContext(c.env.DB, token);
  if (!row) return unauthorized(c, 'The access token is invalid or expired.');

  const user: UserRecord = {
    id: row.user_id,
    email: row.user_email,
    password: row.user_password,
    salt: row.user_salt,
    role: row.user_role,
    created_at: row.user_created_at,
    updated_at: row.user_updated_at,
  };
  const profile: ProfileRecord = {
    id: row.profile_id,
    user_id: row.user_id,
    name: row.profile_name,
    skin_hash: row.skin_hash,
    cape_hash: row.cape_hash,
    skin_model: row.skin_model,
  };
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
  await next();
};

export const adminMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') {
    return jsonError(c, 403, 'Administrator access is required.', 'Forbidden', 'forbidden');
  }
  await next();
};
