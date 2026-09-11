import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  deleteToken,
  deleteUserTokens,
  findProfileById,
  findProfileByUserId,
  findUserByEmail,
  findTokenContext,
  insertToken,
  rotateToken,
} from '../db/queries';
import { getClientKey, isLoginAllowed, clearLoginFailures, recordLoginFailure } from '../middleware/ratelimit';
import { createAccessToken, verifyPassword } from '../utils/crypto';
import { getTokenExpiryMs } from '../utils/config';
import { metadata } from '../utils/config';
import { readJson, yggError } from '../utils/errors';
import type { AppEnv, ProfileRecord, TokenRecord, UserRecord } from '../types';

interface AuthenticateRequest {
  username?: unknown;
  password?: unknown;
  clientToken?: unknown;
  requestUser?: unknown;
}

interface TokenRequest {
  accessToken?: unknown;
  clientToken?: unknown;
  selectedProfile?: unknown;
  requestUser?: unknown;
}

interface ProfileSelection {
  id?: unknown;
}

const routes = new Hono<AppEnv>();

routes.get('/', metadata);

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function profileResponse(profile: ProfileRecord): { id: string; name: string } {
  return { id: profile.id, name: profile.name };
}

function tokenResponse(
  token: TokenRecord,
  profile: ProfileRecord,
  user: UserRecord,
  requestUser: boolean,
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    accessToken: token.access_token,
    clientToken: token.client_token,
    availableProfiles: [profileResponse(profile)],
    selectedProfile: profileResponse(profile),
  };
  if (requestUser) response.user = { id: user.id, properties: [] };
  return response;
}

function invalidCredentials(c: Context<AppEnv>): Response {
  return yggError(c, 403, 'Invalid credentials. Invalid username or password.');
}

async function readTokenContext(c: Context<AppEnv>, body: TokenRequest) {
  const accessToken = asNonEmptyString(body.accessToken);
  if (!accessToken) return { error: yggError(c, 400, 'accessToken is required.') } as const;
  const context = await findTokenContext(c.env.DB, accessToken);
  if (!context) return { error: yggError(c, 403, 'Invalid token.') } as const;
  const clientToken = asNonEmptyString(body.clientToken);
  if (clientToken && clientToken !== context.client_token) {
    return { error: yggError(c, 403, 'Invalid token.') } as const;
  }
  return { accessToken, context } as const;
}

routes.post('/authserver/authenticate', async (c) => {
  const clientKey = getClientKey(c.req.raw);
  if (!isLoginAllowed(clientKey)) {
    return yggError(c, 403, 'Too many failed login attempts. Try again later.');
  }

  const body = await readJson<AuthenticateRequest>(c);
  const username = asNonEmptyString(body?.username);
  const password = asNonEmptyString(body?.password);
  if (!username || !password) return yggError(c, 400, 'username and password are required.');

  const email = username.toLowerCase();
  const user = await findUserByEmail(c.env.DB, email);
  const passwordMatches = user ? await verifyPassword(password, user.salt, user.password) : false;
  if (!user || !passwordMatches) {
    recordLoginFailure(clientKey);
    return invalidCredentials(c);
  }

  const profile = await findProfileByUserId(c.env.DB, user.id);
  if (!profile) return yggError(c, 500, 'The account profile is unavailable.', 'InternalServerError');

  const now = Date.now();
  const token: TokenRecord = {
    access_token: createAccessToken(),
    client_token: asNonEmptyString(body?.clientToken) ?? crypto.randomUUID(),
    user_id: user.id,
    profile_id: profile.id,
    created_at: now,
    expires_at: now + getTokenExpiryMs(c),
  };
  await insertToken(c.env.DB, token);
  clearLoginFailures(clientKey);
  return c.json(tokenResponse(token, profile, user, body?.requestUser === true));
});

routes.post('/authserver/refresh', async (c) => {
  const body = await readJson<TokenRequest>(c);
  if (!body) return yggError(c, 400, 'A valid JSON body is required.');
  const result = await readTokenContext(c, body);
  if ('error' in result) return result.error;

  const profileSelection = body.selectedProfile as ProfileSelection | undefined;
  const selectedId = asNonEmptyString(profileSelection?.id);
  const profile = selectedId
    ? await findProfileById(c.env.DB, selectedId)
    : await findProfileById(c.env.DB, result.context.profile_id);
  if (!profile || profile.user_id !== result.context.user_id) {
    return yggError(c, 400, 'selectedProfile is invalid.');
  }

  const now = Date.now();
  const token: TokenRecord = {
    access_token: createAccessToken(),
    client_token: result.context.client_token,
    user_id: result.context.user_id,
    profile_id: profile.id,
    created_at: now,
    expires_at: now + getTokenExpiryMs(c),
  };
  await rotateToken(c.env.DB, result.accessToken, token);
  const user: UserRecord = {
    id: result.context.user_id,
    email: result.context.user_email,
    password: result.context.user_password,
    salt: result.context.user_salt,
    role: result.context.user_role,
    created_at: 0,
    updated_at: 0,
  };
  return c.json(tokenResponse(token, profile, user, body.requestUser === true));
});

routes.post('/authserver/validate', async (c) => {
  const body = await readJson<TokenRequest>(c);
  if (!body) return yggError(c, 400, 'A valid JSON body is required.');
  const result = await readTokenContext(c, body);
  if ('error' in result) return result.error;
  return c.body(null, 204);
});

routes.post('/authserver/invalidate', async (c) => {
  const body = await readJson<TokenRequest>(c);
  if (!body) return yggError(c, 400, 'A valid JSON body is required.');
  const result = await readTokenContext(c, body);
  if ('error' in result) return result.error;
  await deleteToken(c.env.DB, result.accessToken);
  return c.body(null, 204);
});

routes.post('/authserver/signout', async (c) => {
  const clientKey = getClientKey(c.req.raw);
  if (!isLoginAllowed(clientKey)) {
    return yggError(c, 403, 'Too many failed login attempts. Try again later.');
  }
  const body = await readJson<AuthenticateRequest>(c);
  const username = asNonEmptyString(body?.username);
  const password = asNonEmptyString(body?.password);
  if (!username || !password) return yggError(c, 400, 'username and password are required.');

  const user = await findUserByEmail(c.env.DB, username.toLowerCase());
  const passwordMatches = user ? await verifyPassword(password, user.salt, user.password) : false;
  if (!user || !passwordMatches) {
    recordLoginFailure(clientKey);
    return invalidCredentials(c);
  }

  await deleteUserTokens(c.env.DB, user.id);
  clearLoginFailures(clientKey);
  return c.body(null, 204);
});

export default routes;
