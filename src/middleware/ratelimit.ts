export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;

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
