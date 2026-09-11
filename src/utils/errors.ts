import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface StandardError {
  error: string;
  errorMessage: string;
  cause?: string;
}

export function jsonError(
  c: Context,
  status: number,
  errorMessage: string,
  error = 'IllegalArgumentException',
): Response {
  return c.json({ error, errorMessage }, status as ContentfulStatusCode);
}

export function yggError(
  c: Context,
  status: number,
  errorMessage: string,
  error = 'ForbiddenOperationException',
): Response {
  return jsonError(c, status, errorMessage, error);
}

export async function readJson<T>(c: Context): Promise<T | null> {
  try {
    return await c.req.json<T>();
  } catch {
    return null;
  }
}
