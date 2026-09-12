import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  deleteToken,
  deleteUserTokens,
  findProfileById,
  findDefaultProfileByUserId,
  listProfilesByUserId,
  findUserByEmail,
  findTokenContext,
  insertToken,
  rotateToken,
} from '../db/queries';
import {
  admitLoginAttempt,
  checkLoginLimit,
  clearLoginFailuresDistributed,
  getClientKey,
  LOGIN_TURNSTILE_THRESHOLD,
  recordLoginFailureDistributed,
} from '../middleware/ratelimit';
import { createAccessToken, verifyPassword } from '../utils/crypto';
import { getTokenExpiryMs, metadata } from '../utils/config';
import { readJson, yggError } from '../utils/errors';
import { turnstileTokenFromBody, verifyTurnstileToken } from '../utils/turnstile';
import type { AppEnv, ProfileRecord, TokenRecord, UserRecord } from '../types';

interface AuthenticateRequest {
  username?: unknown;
  password?: unknown;
  clientToken?: unknown;
  requestUser?: unknown;
  turnstileToken?: unknown;
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

function asPassword(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function profileResponse(profile: ProfileRecord): { id: string; name: string } {
  return { id: profile.id, name: profile.name };
}

function tokenResponse(
  token: TokenRecord,
  selectedProfile: ProfileRecord,
  profiles: ProfileRecord[],
  user: UserRecord,
  requestUser: boolean,
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    accessToken: token.access_token,
    clientToken: token.client_token,
    availableProfiles: profiles.map(profileResponse),
    selectedProfile: profileResponse(selectedProfile),
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
  const body = await readJson<AuthenticateRequest>(c);
  const username = asNonEmptyString(body?.username);
  const password = asPassword(body?.password);
  if (!username || !password) return yggError(c, 400, 'username and password are required.');
  if (password.length > 256) return yggError(c, 400, 'password must be 256 characters or fewer.');

  const clientKey = getClientKey(c.req.raw);
  const admission = await admitLoginAttempt(c.env, clientKey);
  if (!admission.allowed) {
    return yggError(c, 403, 'Too many failed login attempts. Try again later.');
  }

  const priorFailures = Math.max(0, admission.failedCount - 1);
  if (priorFailures >= LOGIN_TURNSTILE_THRESHOLD) {
    const turnstileValid = await verifyTurnstileToken(
      turnstileTokenFromBody(body),
      c.env.TURNSTILE_SECRET_KEY,
      { remoteIp: clientKey === 'unknown' ? undefined : clientKey },
    );
    if (!turnstileValid) {
      return invalidCredentials(c);
    }
  }

  const email = username.toLowerCase();
  const user = await findUserByEmail(c.env.DB, email);
  const passwordMatches = user ? await verifyPassword(password, user.salt, user.password) : false;
  if (!user || !passwordMatches) {
    return invalidCredentials(c);
  }

  const profile = await findDefaultProfileByUserId(c.env.DB, user.id);
  if (!profile) return yggError(c, 500, 'The account profile is unavailable.', 'InternalServerError');
  const profiles = await listProfilesByUserId(c.env.DB, user.id);

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
  await clearLoginFailuresDistributed(c.env, clientKey);
  return c.json(tokenResponse(token, profile, profiles.length > 0 ? profiles : [profile], user, body?.requestUser === true));
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
    created_at: result.context.user_created_at,
    updated_at: result.context.user_updated_at,
  };
  const profiles = await listProfilesByUserId(c.env.DB, result.context.user_id);
  return c.json(tokenResponse(token, profile, profiles.length > 0 ? profiles : [profile], user, body.requestUser === true));
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
  const limit = await checkLoginLimit(c.env, clientKey);
  if (!limit.allowed) {
    return yggError(c, 403, 'Too many failed login attempts. Try again later.');
  }
  const body = await readJson<AuthenticateRequest>(c);
  const username = asNonEmptyString(body?.username);
  const password = asPassword(body?.password);
  if (!username || !password) return yggError(c, 400, 'username and password are required.');
  if (password.length > 256) return yggError(c, 400, 'password must be 256 characters or fewer.');

  const user = await findUserByEmail(c.env.DB, username.toLowerCase());
  const passwordMatches = user ? await verifyPassword(password, user.salt, user.password) : false;
  if (!user || !passwordMatches) {
    await recordLoginFailureDistributed(c.env, clientKey);
    return invalidCredentials(c);
  }

  await deleteUserTokens(c.env.DB, user.id);
  await clearLoginFailuresDistributed(c.env, clientKey);
  return c.body(null, 204);
});

export default routes;
