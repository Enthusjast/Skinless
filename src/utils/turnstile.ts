export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileVerifyOptions {
  remoteIp?: string;
  fetch?: typeof fetch;
}

export function turnstileTokenFromBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const token = record.turnstileToken ?? record.turnstile_token ?? record['cf-turnstile-response'];
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

export async function verifyTurnstileToken(
  token: unknown,
  secret: string | undefined,
  options: TurnstileVerifyOptions = {},
): Promise<boolean> {
  const normalizedSecret = secret?.trim();
  if (!normalizedSecret) return true;
  if (typeof token !== 'string' || !token.trim()) return false;

  const form = new URLSearchParams({
    secret: normalizedSecret,
    response: token.trim(),
  });
  if (options.remoteIp?.trim()) form.set('remoteip', options.remoteIp.trim());

  try {
    const response = await (options.fetch ?? fetch)(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: unknown };
    return result.success === true;
  } catch {
    return false;
  }
}
