import type { MiddlewareHandler } from 'hono';
import type { AppEnv, ProfileRecord, TokenRecord, UserRecord } from '../types';
import { findTokenContext } from '../db/queries';

function unauthorized(c: Parameters<MiddlewareHandler<AppEnv>>[0], message: string): Response {
  return c.json({ error: 'Unauthorized', errorMessage: message }, 401);
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
    created_at: 0,
    updated_at: 0,
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
    return c.json({ error: 'Forbidden', errorMessage: 'Administrator access is required.' }, 403);
  }
  await next();
};
