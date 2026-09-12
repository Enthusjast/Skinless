import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface StandardError {
  error: string;
  errorMessage: string;
  errorCode?: string;
  cause?: string;
}

function defaultErrorCode(error: string): string {
  switch (error) {
    case 'Conflict':
      return 'conflict';
    case 'Forbidden':
      return 'forbidden';
    case 'NotFound':
      return 'not_found';
    case 'Unauthorized':
      return 'unauthorized';
    default:
      return 'invalid_request';
  }
}

export function jsonError(
  c: Context,
  status: number,
  errorMessage: string,
  error = 'IllegalArgumentException',
  errorCode = defaultErrorCode(error),
): Response {
  return c.json({ error, errorMessage, errorCode }, status as ContentfulStatusCode);
}

export function yggError(
  c: Context,
  status: number,
  errorMessage: string,
  error = 'ForbiddenOperationException',
): Response {
  return c.json({ error, errorMessage }, status as ContentfulStatusCode);
}

export async function readJson<T>(c: Context): Promise<T | null> {
  try {
    return await c.req.json<T>();
  } catch {
    return null;
  }
}
