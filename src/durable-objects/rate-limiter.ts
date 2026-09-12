const STATE_KEY = 'window';

export type RateLimitAction = 'check' | 'record' | 'admit' | 'clear';

export interface RateLimitRequest {
  action: RateLimitAction;
  windowMs: number;
  limit: number;
  blockMs: number;
  now?: number;
}

export interface RateLimitResponse {
  allowed: boolean;
  blocked: boolean;
  retryAfter: number;
  failedCount: number;
}

interface RateLimitState {
  windowStartedAt: number;
  failedCount: number;
  blockedUntil: number;
}

const emptyResponse: RateLimitResponse = {
  allowed: true,
  blocked: false,
  retryAfter: 0,
  failedCount: 0,
};

function responseFor(state: RateLimitState | undefined, now: number): RateLimitResponse {
  if (!state) return { ...emptyResponse };

  const retryAfter = state.blockedUntil > now ? state.blockedUntil - now : 0;
  return {
    allowed: retryAfter === 0,
    blocked: retryAfter > 0,
    retryAfter,
    failedCount: state.failedCount,
  };
}

function invalidRequest(message: string): Response {
  return Response.json({ error: 'invalid_request', errorMessage: message }, { status: 400 });
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isValidRequest(value: unknown): value is RateLimitRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<RateLimitRequest>;
  return (
    (request.action === 'check' || request.action === 'record' || request.action === 'admit' || request.action === 'clear') &&
    isPositiveFiniteNumber(request.windowMs) &&
    isPositiveFiniteNumber(request.limit) &&
    isPositiveFiniteNumber(request.blockMs) &&
    (request.now === undefined || (typeof request.now === 'number' && Number.isFinite(request.now)))
  );
}

function isExpired(state: RateLimitState, now: number, windowMs: number): boolean {
  if (state.blockedUntil > 0) return state.blockedUntil <= now;
  return state.windowStartedAt + windowMs <= now;
}

export class RateLimiterDurableObject implements DurableObject {
  public constructor(
    private readonly ctx: DurableObjectState,
    _env: unknown,
  ) {}

  public async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return invalidRequest('A valid JSON body is required.');
    }
    if (!isValidRequest(input)) {
      return invalidRequest('action, windowMs, limit and blockMs are required.');
    }

    const now = input.now ?? Date.now();
    const result = await this.ctx.storage.transaction(async (transaction) => {
      let state = await transaction.get<RateLimitState>(STATE_KEY);
      if (state && isExpired(state, now, input.windowMs)) {
        await transaction.delete(STATE_KEY);
        state = undefined;
      }

      if (input.action === 'clear') {
        if (state) await transaction.delete(STATE_KEY);
        return { ...emptyResponse };
      }

      if (input.action === 'check') return responseFor(state, now);

      const current = responseFor(state, now);
      if (!current.allowed) return current;

      const nextState: RateLimitState = {
        windowStartedAt: state?.windowStartedAt ?? now,
        failedCount: (state?.failedCount ?? 0) + 1,
        blockedUntil: 0,
      };
      if (nextState.failedCount >= input.limit) {
        nextState.blockedUntil = now + input.blockMs;
      }
      await transaction.put(STATE_KEY, nextState);
      const nextResponse = responseFor(nextState, now);
      return { ...nextResponse, allowed: true };
    });

    return Response.json(result);
  }
}
