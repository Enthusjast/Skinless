import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { registerVerifiedAccount } from './verified-registration-fixture';

interface SentCode {
  email: string;
  code: string;
}

let nextIp = 140;

function request(
  path: string,
  body: unknown,
  bindings: Record<string, unknown>,
): Promise<Response> {
  return Promise.resolve(app.request('https://worker.test' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `198.51.100.${nextIp++}`,
    },
    body: JSON.stringify(body),
  }, bindings as never));
}

function mailBindings(sent: SentCode[]): Record<string, unknown> {
  return {
    ...env,
    MAIL_SENDER: {
      async sendVerificationCode(email: string, code: string) {
        sent.push({ email, code });
      },
    },
  };
}

function cookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Missing ${name} cookie`);
  return match[1];
}

function cookieHeader(setCookie: string): string {
  return [
    '__Host-skinless_access',
    '__Host-skinless_refresh',
    'skinless_csrf',
  ].map((name) => `${name}=${cookieValue(setCookie, name)}`).join('; ');
}

async function webLogin(email: string, password: string): Promise<{
  cookie: string;
  csrfToken: string;
  sessionId: string;
}> {
  const response = await app.request('https://worker.test/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `198.51.100.${nextIp++}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    },
    body: JSON.stringify({ email, password }),
  }, env as never);
  expect(response.status).toBe(200);
  const body = await response.json() as { csrfToken: string };
  const setCookie = response.headers.get('set-cookie') ?? '';
  const refresh = cookieValue(setCookie, '__Host-skinless_refresh');
  return {
    cookie: cookieHeader(setCookie),
    csrfToken: body.csrfToken,
    sessionId: refresh.split('.')[0] ?? '',
  };
}

function cookieRequest(
  path: string,
  method: string,
  cookie: string,
  csrfToken?: string,
  body?: unknown,
  bindings: unknown = env,
): Promise<Response> {
  const headers = new Headers({ Cookie: cookie, 'CF-Connecting-IP': `198.51.100.${nextIp++}` });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  return Promise.resolve(app.request('https://worker.test' + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, bindings as never));
}

describe('account recovery against real D1', () => {
  it('returns one generic reset-start response for existing and unknown emails', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const email = `recovery-${suffix}@example.com`;
    await registerVerifiedAccount(email, 'correct-password', `Recover${suffix.slice(0, 8)}`);
    const sent: SentCode[] = [];
    const bindings = mailBindings(sent);

    const existing = await request('/api/auth/password/reset/start', { email }, bindings);
    const unknown = await request('/api/auth/password/reset/start', {
      email: `missing-${suffix}@example.com`,
    }, bindings);

    expect(existing.status).toBe(202);
    expect(unknown.status).toBe(202);
    const existingBody = await existing.json() as {
      message: string;
      challengeId: string;
      expiresAt: number;
      resendAfter: number;
    };
    const unknownBody = await unknown.json() as typeof existingBody;
    expect(existingBody).toMatchObject({
      message: 'If an account exists for this email, a password reset code has been sent.',
    });
    expect(unknownBody).toMatchObject({ message: existingBody.message });
    expect(existingBody.challengeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(unknownBody.challengeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(existingBody.expiresAt).toBeGreaterThan(Date.now());
    expect(existingBody.resendAfter).toBeGreaterThan(Date.now());
    expect(Object.keys(existingBody).sort()).toEqual([
      'challengeId',
      'expiresAt',
      'message',
      'resendAfter',
    ]);
    expect(Object.keys(unknownBody).sort()).toEqual(Object.keys(existingBody).sort());
    expect(existingBody.message).toBe(
      'If an account exists for this email, a password reset code has been sent.',
    );
    expect(sent).toHaveLength(1);
  });

  it('expires reset codes, limits attempts, enforces resend cooldown, and revokes sessions and tokens', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const email = `reset-${suffix}@example.com`;
    const password = 'correct-password';
    await registerVerifiedAccount(email, password, `Reset${suffix.slice(0, 9)}`);
    const sent: SentCode[] = [];
    const bindings = mailBindings(sent);
    const authenticate = await request('/authserver/authenticate', {
      username: email,
      password,
      clientToken: `client-${suffix}`,
    }, env as never);
    const authenticateBody = await authenticate.json() as { accessToken: string; clientToken: string };
    const currentSession = await webLogin(email, password);
    const otherSession = await webLogin(email, password);

    const start = await request('/api/auth/password/reset/start', { email }, bindings);
    expect(start.status).toBe(202);
    const startBody = await start.json() as { challengeId: string };
    expect(sent).toHaveLength(1);

    const tooSoon = await request('/api/auth/password/reset/resend', {
      challengeId: startBody.challengeId,
    }, bindings);
    expect(tooSoon.status).toBe(429);
    await expect(tooSoon.json()).resolves.toMatchObject({ errorCode: 'resend_cooldown' });

    await env.DB.prepare('UPDATE account_challenges SET last_sent_at = ? WHERE id = ?')
      .bind(Date.now() - 61_000, startBody.challengeId)
      .run();
    const resend = await request('/api/auth/password/reset/resend', {
      challengeId: startBody.challengeId,
    }, bindings);
    expect(resend.status).toBe(202);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.code).not.toBe(sent[0]?.code);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await request('/api/auth/password/reset/verify', {
        challengeId: startBody.challengeId,
        code: '000000',
        newPassword: 'new-password',
      }, bindings);
      expect(wrong.status).toBe(400);
    }
    const exhausted = await request('/api/auth/password/reset/verify', {
      challengeId: startBody.challengeId,
      code: sent[1]?.code,
      newPassword: 'new-password',
    }, bindings);
    expect(exhausted.status).toBe(429);
    await expect(exhausted.json()).resolves.toMatchObject({ errorCode: 'verification_attempts_exhausted' });

    await env.DB.prepare('UPDATE account_challenges SET attempts = 0, expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1, startBody.challengeId)
      .run();
    const expired = await request('/api/auth/password/reset/verify', {
      challengeId: startBody.challengeId,
      code: sent[1]?.code,
      newPassword: 'new-password',
    }, bindings);
    expect(expired.status).toBe(400);
    await expect(expired.json()).resolves.toMatchObject({ errorCode: 'invalid_verification_code' });

    const refreshedStart = await request('/api/auth/password/reset/start', { email }, bindings);
    expect(refreshedStart.status).toBe(202);
    const refreshedBody = await refreshedStart.json() as { challengeId: string };
    const reset = await request('/api/auth/password/reset/verify', {
      challengeId: refreshedBody.challengeId,
      code: sent[2]?.code,
      newPassword: 'new-password',
    }, bindings);
    expect(reset.status).toBe(204);

    const tokenValidation = await request('/authserver/validate', {
      accessToken: authenticateBody.accessToken,
      clientToken: authenticateBody.clientToken,
    }, env as never);
    expect(tokenValidation.status).toBe(403);
    const currentProfile = await cookieRequest('/api/user/profile', 'GET', currentSession.cookie);
    expect(currentProfile.status).toBe(401);
    const secondProfile = await cookieRequest('/api/user/profile', 'GET', otherSession.cookie);
    expect(secondProfile.status).toBe(401);
    const newLogin = await request('/api/auth/login', { email, password: 'new-password' }, env as never);
    expect(newLogin.status).toBe(200);
  });

  it('requires CSRF and the current password, atomically changes email, verifies it, and revokes other sessions', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const email = `email-change-${suffix}@example.com`;
    const password = 'correct-password';
    const target = `new-${suffix}@example.com`;
    const duplicate = `duplicate-${suffix}@example.com`;
    await registerVerifiedAccount(email, password, `Email${suffix.slice(0, 10)}`);
    await registerVerifiedAccount(duplicate, password, `Dup${suffix.slice(0, 10)}`);
    const currentSession = await webLogin(email, password);
    const otherSession = await webLogin(email, password);
    const sent: SentCode[] = [];
    const bindings = mailBindings(sent);

    const missingCsrf = await cookieRequest('/api/user/email/change/start', 'POST', currentSession.cookie, undefined, {
      currentPassword: password,
      newEmail: target,
    });
    expect(missingCsrf.status).toBe(403);
    await expect(missingCsrf.json()).resolves.toMatchObject({ errorCode: 'forbidden' });

    const wrongPassword = await cookieRequest('/api/user/email/change/start', 'POST', currentSession.cookie, currentSession.csrfToken, {
      currentPassword: 'wrong-password',
      newEmail: target,
    });
    expect(wrongPassword.status).toBe(403);
    await expect(wrongPassword.json()).resolves.toMatchObject({ errorCode: 'current_password_incorrect' });

    const duplicateResponse = await cookieRequest('/api/user/email/change/start', 'POST', currentSession.cookie, currentSession.csrfToken, {
      currentPassword: password,
      newEmail: duplicate.toUpperCase(),
    });
    expect(duplicateResponse.status).toBe(409);
    await expect(duplicateResponse.json()).resolves.toMatchObject({ errorCode: 'email_in_use' });

    const start = await cookieRequest('/api/user/email/change/start', 'POST', currentSession.cookie, currentSession.csrfToken, {
      currentPassword: password,
      newEmail: `  ${target.toUpperCase()} `,
    }, bindings);
    expect(start.status).toBe(202);
    const startBody = await start.json() as { challengeId: string; email: string };
    expect(startBody.email).toBe(target);
    expect(sent).toHaveLength(1);

    const tooSoon = await cookieRequest('/api/user/email/change/resend', 'POST', currentSession.cookie, currentSession.csrfToken, {
      challengeId: startBody.challengeId,
    }, bindings);
    expect(tooSoon.status).toBe(429);
    await env.DB.prepare('UPDATE account_challenges SET last_sent_at = ? WHERE id = ?')
      .bind(Date.now() - 61_000, startBody.challengeId)
      .run();
    const resend = await cookieRequest('/api/user/email/change/resend', 'POST', currentSession.cookie, currentSession.csrfToken, {
      challengeId: startBody.challengeId,
    }, bindings);
    expect(resend.status).toBe(202);
    expect(sent).toHaveLength(2);

    const oldCode = await cookieRequest('/api/user/email', 'PUT', currentSession.cookie, currentSession.csrfToken, {
      challengeId: startBody.challengeId,
      code: sent[0]?.code,
      currentPassword: password,
    }, bindings);
    expect(oldCode.status).toBe(400);
    const complete = await cookieRequest('/api/user/email', 'PUT', currentSession.cookie, currentSession.csrfToken, {
      challengeId: startBody.challengeId,
      code: sent[1]?.code,
      currentPassword: password,
    }, bindings);
    expect(complete.status).toBe(200);
    await expect(complete.json()).resolves.toMatchObject({ user: { email: target } });

    const currentProfile = await cookieRequest('/api/user/profile', 'GET', currentSession.cookie);
    expect(currentProfile.status).toBe(200);
    await expect(currentProfile.json()).resolves.toMatchObject({ user: { email: target } });
    const otherProfile = await cookieRequest('/api/user/profile', 'GET', otherSession.cookie);
    expect(otherProfile.status).toBe(401);
    const userRow = await env.DB.prepare('SELECT email, email_verified_at FROM users WHERE email = ?')
      .bind(target)
      .first<{ email: string; email_verified_at: number | null }>();
    expect(userRow).toMatchObject({ email: target });
    expect(userRow?.email_verified_at).not.toBeNull();

    const atomicTarget = `atomic-${suffix}@example.com`;
    const secondStart = await cookieRequest('/api/user/email/change/start', 'POST', currentSession.cookie, currentSession.csrfToken, {
      currentPassword: password,
      newEmail: atomicTarget,
    }, bindings);
    expect(secondStart.status).toBe(202);
    const secondBody = await secondStart.json() as { challengeId: string };
    await registerVerifiedAccount(atomicTarget, password, `Atomic${suffix.slice(0, 9)}`);
    const racedDuplicate = await cookieRequest('/api/user/email', 'PUT', currentSession.cookie, currentSession.csrfToken, {
      challengeId: secondBody.challengeId,
      code: sent[2]?.code,
      currentPassword: password,
    }, bindings);
    expect(racedDuplicate.status).toBe(409);
    await expect(racedDuplicate.json()).resolves.toMatchObject({ errorCode: 'email_in_use' });
  });
});
