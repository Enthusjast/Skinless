import type { RateLimitRequest, RateLimitResponse } from '../durable-objects/rate-limiter';

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_TURNSTILE_THRESHOLD = 3;
export const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
export const REGISTRATION_IP_LIMIT = 5;
export const REGISTRATION_EMAIL_LIMIT = 3;

const RATE_LIMITER_ENDPOINT = 'https://rate-limiter.internal/limit';
const RATE_LIMITER_FAILURE_RETRY_MS = 60 * 1000;

interface RateLimiterStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

interface RateLimiterNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): RateLimiterStub;
}

export type RateLimiterEnvironment = {
  RATE_LIMITER?: RateLimiterNamespace;
  TURNSTILE_SECRET_KEY?: string;
};

interface LoginFailureState {
  count: number;
  blockedUntil: number;
}

const failures = new Map<string, LoginFailureState>();

export function isLoginAllowed(clientKey: string, now = Date.now()): boolean {
  const state = failures.get(clientKey);
  if (!state) return true;

  if (state.blockedUntil > 0 && state.blockedUntil <= now) {
    failures.delete(clientKey);
    return true;
  }

  return state.blockedUntil === 0 || state.blockedUntil <= now;
}

export function recordLoginFailure(clientKey: string, now = Date.now()): void {
  const state = failures.get(clientKey) ?? { count: 0, blockedUntil: 0 };
  state.count += 1;
  if (state.count >= LOGIN_FAILURE_LIMIT) {
    state.blockedUntil = now + LOGIN_BLOCK_MS;
  }
  failures.set(clientKey, state);
}

export function clearLoginFailures(clientKey?: string): void {
  if (clientKey) {
    failures.delete(clientKey);
  } else {
    failures.clear();
  }
}

export function getClientKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
}

const emptyRateLimitResponse: RateLimitResponse = {
  allowed: true,
  blocked: false,
  retryAfter: 0,
  failedCount: 0,
};

function limiterFailureResponse(): RateLimitResponse {
  return {
    allowed: false,
    blocked: true,
    retryAfter: RATE_LIMITER_FAILURE_RETRY_MS,
    failedCount: 0,
  };
}

async function requestRateLimit(
  env: RateLimiterEnvironment,
  name: string,
  request: Omit<RateLimitRequest, 'now'>,
): Promise<RateLimitResponse> {
  if (!env.RATE_LIMITER) return { ...emptyRateLimitResponse };

  try {
    const id = env.RATE_LIMITER.idFromName(name);
    const response = await env.RATE_LIMITER.get(id).fetch(RATE_LIMITER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) return limiterFailureResponse();
    return await response.json() as RateLimitResponse;
  } catch {
    return limiterFailureResponse();
  }
}

export function normalizeRateLimitEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function checkLoginLimit(
  env: RateLimiterEnvironment,
  clientKey: string,
): Promise<RateLimitResponse> {
  return requestRateLimit(env, `login:${clientKey}`, {
    action: 'check',
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_FAILURE_LIMIT,
    blockMs: LOGIN_BLOCK_MS,
  });
}

export function admitLoginAttempt(
  env: RateLimiterEnvironment,
  clientKey: string,
): Promise<RateLimitResponse> {
  return requestRateLimit(env, `login:${clientKey}`, {
    action: 'admit',
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_FAILURE_LIMIT,
    blockMs: LOGIN_BLOCK_MS,
  });
}

export function recordLoginFailureDistributed(
  env: RateLimiterEnvironment,
  clientKey: string,
): Promise<RateLimitResponse> {
  return requestRateLimit(env, `login:${clientKey}`, {
    action: 'record',
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_FAILURE_LIMIT,
    blockMs: LOGIN_BLOCK_MS,
  });
}

export function clearLoginFailuresDistributed(
  env: RateLimiterEnvironment,
  clientKey: string,
): Promise<RateLimitResponse> {
  return requestRateLimit(env, `login:${clientKey}`, {
    action: 'clear',
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_FAILURE_LIMIT,
    blockMs: LOGIN_BLOCK_MS,
  });
}

export function recordRegistrationIpAttempt(
  env: RateLimiterEnvironment,
  clientKey: string,
): Promise<RateLimitResponse> {
  return requestRateLimit(env, `registration:ip:${clientKey}`, {
    action: 'record',
    windowMs: REGISTRATION_WINDOW_MS,
    limit: REGISTRATION_IP_LIMIT,
    blockMs: REGISTRATION_WINDOW_MS,
  });
}

export function recordRegistrationEmailAttempt(
  env: RateLimiterEnvironment,
  email: string,
): Promise<RateLimitResponse> {
  return requestRateLimit(env, `registration:email:${normalizeRateLimitEmail(email)}`, {
    action: 'record',
    windowMs: REGISTRATION_WINDOW_MS,
    limit: REGISTRATION_EMAIL_LIMIT,
    blockMs: REGISTRATION_WINDOW_MS,
  });
}
