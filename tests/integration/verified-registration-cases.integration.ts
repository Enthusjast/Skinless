import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { hashPassword } from '../../src/utils/crypto';
import { hashSessionToken } from '../../src/utils/session';
import { registerVerifiedAccount } from './verified-registration-fixture';

type RegistrationMode = 'open' | 'invite' | 'closed';

interface SentCode {
  email: string;
  code: string;
}

let nextIp = 80;

function mailBindings(sent: SentCode[], extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...env,
    ...extras,
    MAIL_SENDER: {
      async sendVerificationCode(email: string, code: string) {
        sent.push({ email, code });
      },
    },
  };
}

function request(
  path: string,
  body: unknown,
  bindings: Record<string, unknown>,
): Promise<Response> {
  const ip = '198.51.100.' + nextIp++;
  return Promise.resolve(app.request('https://worker.test' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  }, bindings as never));
}

async function setRegistrationMode(mode: RegistrationMode): Promise<void> {
  await env.DB.prepare(
    'UPDATE site_settings SET registration_mode = ?, updated_at = ? WHERE id = 1',
  ).bind(mode, Date.now()).run();
}

function accountValues(prefix: string): { email: string; name: string } {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  return {
    email: prefix + '-' + suffix + '@example.com',
    name: prefix.slice(0, 8) + suffix.slice(0, 8),
  };
}

afterEach(async () => {
  await setRegistrationMode('open');
});

describe('verified registration policy and delivery', () => {
  it('enforces open, invite, and closed modes and leaves no pending row without mail', async () => {
    const closed = accountValues('closed');
    await setRegistrationMode('closed');
    const closedResponse = await request('/api/auth/register/start', {
      email: closed.email,
      password: 'correct-password',
      name: closed.name,
    }, mailBindings([]));
    expect(closedResponse.status).toBe(403);
    await expect(closedResponse.json()).resolves.toMatchObject({ errorCode: 'registration_closed' });

    await setRegistrationMode('invite');
    const missingInvite = accountValues('invite');
    const missingInviteResponse = await request('/api/auth/register/start', {
      email: missingInvite.email,
      password: 'correct-password',
      name: missingInvite.name,
    }, mailBindings([]));
    expect(missingInviteResponse.status).toBe(400);
    await expect(missingInviteResponse.json()).resolves.toMatchObject({ errorCode: 'invite_required' });

    const invalidInvite = accountValues('invite');
    const invalidInviteResponse = await request('/api/auth/register/start', {
      email: invalidInvite.email,
      password: 'correct-password',
      name: invalidInvite.name,
      inviteCode: 'not-a-real-invite',
    }, mailBindings([]));
    expect(invalidInviteResponse.status).toBe(400);
    await expect(invalidInviteResponse.json()).resolves.toMatchObject({ errorCode: 'invalid_invite' });

    await setRegistrationMode('open');
    const unconfigured = accountValues('unconfigured');
    const unconfiguredResponse = await request('/api/auth/register/start', {
      email: unconfigured.email,
      password: 'correct-password',
      name: unconfigured.name,
    }, { ...env });
    expect(unconfiguredResponse.status).toBe(503);
    await expect(unconfiguredResponse.json()).resolves.toMatchObject({ errorCode: 'mail_not_configured' });
    await expect(env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(unconfigured.email).first()).resolves.toBeNull();
    await expect(
      env.DB.prepare('SELECT id FROM pending_registrations WHERE email = ?').bind(unconfigured.email).first(),
    ).resolves.toBeNull();
  });

  it('rejects duplicate pending and verified emails and profile names generically', async () => {
    const first = accountValues('duplicate');
    const sent: SentCode[] = [];
    const bindings = mailBindings(sent);
    const start = await request('/api/auth/register/start', {
      email: first.email,
      password: 'correct-password',
      name: first.name,
    }, bindings);
    expect(start.status).toBe(202);
    const challenge = await start.json() as { challengeId: string };

    const duplicatePending = accountValues('pending');
    const duplicatePendingResponse = await request('/api/auth/register/start', {
      email: first.email.toUpperCase(),
      password: 'correct-password',
      name: duplicatePending.name,
    }, bindings);
    expect(duplicatePendingResponse.status).toBe(409);
    await expect(duplicatePendingResponse.json()).resolves.toMatchObject({
      errorMessage: 'The email or game name is already in use.',
    });

    const verify = await request('/api/auth/register/verify', {
      challengeId: challenge.challengeId,
      code: sent[0]?.code,
    }, bindings);
    expect(verify.status).toBe(201);

    const duplicateEmail = accountValues('other');
    const duplicateEmailResponse = await request('/api/auth/register/start', {
      email: first.email,
      password: 'correct-password',
      name: duplicateEmail.name,
    }, bindings);
    expect(duplicateEmailResponse.status).toBe(409);

    const duplicateName = accountValues('name');
    const duplicateNameResponse = await request('/api/auth/register/start', {
      email: duplicateName.email,
      password: 'correct-password',
      name: first.name.toLowerCase(),
    }, bindings);
    expect(duplicateNameResponse.status).toBe(409);
    await expect(duplicateNameResponse.json()).resolves.toMatchObject({
      errorMessage: 'The email or game name is already in use.',
    });
  });
});

describe('verification challenge lifecycle', () => {
  it('expires codes and allows exactly five failed attempts', async () => {
    const account = accountValues('attempts');
    const sent: SentCode[] = [];
    const bindings = mailBindings(sent);
    const start = await request('/api/auth/register/start', {
      email: account.email,
      password: 'correct-password',
      name: account.name,
    }, bindings);
    const body = await start.json() as { challengeId: string };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await request('/api/auth/register/verify', {
        challengeId: body.challengeId,
        code: '000000',
      }, bindings);
      expect(wrong.status).toBe(400);
    }
    const exhausted = await request('/api/auth/register/verify', {
      challengeId: body.challengeId,
      code: sent[0]?.code,
    }, bindings);
    expect(exhausted.status).toBe(429);
    await expect(exhausted.json()).resolves.toMatchObject({ errorCode: 'verification_attempts_exhausted' });
    const challenge = await env.DB.prepare(
      'SELECT attempts FROM registration_challenges WHERE id = ?',
    ).bind(body.challengeId).first<{ attempts: number }>();
    expect(challenge).toEqual({ attempts: 5 });

    const expired = accountValues('expired');
    const expiredSent: SentCode[] = [];
    const expiredBindings = mailBindings(expiredSent);
    const expiredStart = await request('/api/auth/register/start', {
      email: expired.email,
      password: 'correct-password',
      name: expired.name,
    }, expiredBindings);
    const expiredBody = await expiredStart.json() as { challengeId: string };
    const expiredAt = Date.now() - 1;
    await env.DB.batch([
      env.DB.prepare('UPDATE pending_registrations SET expires_at = ? WHERE id = ?')
        .bind(expiredAt, expiredBody.challengeId),
      env.DB.prepare('UPDATE registration_challenges SET expires_at = ? WHERE id = ?')
        .bind(expiredAt, expiredBody.challengeId),
    ]);
    const expiredVerify = await request('/api/auth/register/verify', {
      challengeId: expiredBody.challengeId,
      code: expiredSent[0]?.code,
    }, expiredBindings);
    expect(expiredVerify.status).toBe(400);
    await expect(env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(expired.email).first()).resolves.toBeNull();
  });

  it('enforces the resend cooldown and accepts the newest code after resend', async () => {
    const account = accountValues('resend');
    const sent: SentCode[] = [];
    const bindings = mailBindings(sent);
    const start = await request('/api/auth/register/start', {
      email: account.email,
      password: 'correct-password',
      name: account.name,
    }, bindings);
    const body = await start.json() as { challengeId: string };

    const tooSoon = await request('/api/auth/register/resend', {
      challengeId: body.challengeId,
    }, bindings);
    expect(tooSoon.status).toBe(429);
    await expect(tooSoon.json()).resolves.toMatchObject({ errorCode: 'resend_cooldown' });

    await env.DB.prepare(
      'UPDATE registration_challenges SET last_sent_at = ? WHERE id = ?',
    ).bind(Date.now() - 61_000, body.challengeId).run();
    const resend = await request('/api/auth/register/resend', {
      challengeId: body.challengeId,
    }, bindings);
    expect(resend.status).toBe(202);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.code).not.toBe(sent[0]?.code);

    const oldCode = await request('/api/auth/register/verify', {
      challengeId: body.challengeId,
      code: sent[0]?.code,
    }, bindings);
    expect(oldCode.status).toBe(400);
    const currentCode = await request('/api/auth/register/verify', {
      challengeId: body.challengeId,
      code: sent[1]?.code,
    }, bindings);
    expect(currentCode.status).toBe(201);
  });
});

describe('invite consumption and account bootstrap', () => {
  it('consumes an invite only during verification and never exceeds its use limit', async () => {
    const owner = accountValues('owner');
    const ownerUser = await registerVerifiedAccount(owner.email, 'correct-password', owner.name);
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const inviteCode = 'invite-' + suffix;
    const now = Date.now();
    const inviteId = crypto.randomUUID();
    const inviteInsert =
      'INSERT INTO registration_invites ' +
      '(id, code_hash, code_prefix, created_by, use_count, use_limit, expires_at, note, revoked_at, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, 0, 1, NULL, \'\', NULL, ?, ?)';
    await env.DB.prepare(inviteInsert).bind(
      inviteId,
      await hashSessionToken(inviteCode),
      inviteCode.slice(0, 8),
      ownerUser.id,
      now,
      now,
    ).run();
    await setRegistrationMode('invite');

    const first = accountValues('inviteone');
    const second = accountValues('invitesecond');
    const firstSent: SentCode[] = [];
    const secondSent: SentCode[] = [];
    const firstStart = await request('/api/auth/register/start', {
      email: first.email,
      password: 'correct-password',
      name: first.name,
      inviteCode,
    }, mailBindings(firstSent));
    const secondStart = await request('/api/auth/register/start', {
      email: second.email,
      password: 'correct-password',
      name: second.name,
      inviteCode,
    }, mailBindings(secondSent));
    expect(firstStart.status).toBe(202);
    expect(secondStart.status).toBe(202);
    const firstChallenge = await firstStart.json() as { challengeId: string };
    const secondChallenge = await secondStart.json() as { challengeId: string };

    const firstVerify = await request('/api/auth/register/verify', {
      challengeId: firstChallenge.challengeId,
      code: firstSent[0]?.code,
    }, mailBindings(firstSent));
    expect(firstVerify.status).toBe(201);
    const secondVerify = await request('/api/auth/register/verify', {
      challengeId: secondChallenge.challengeId,
      code: secondSent[0]?.code,
    }, mailBindings(secondSent));
    expect(secondVerify.status).toBe(400);
    await expect(secondVerify.json()).resolves.toMatchObject({ errorCode: 'invalid_invite' });

    const invite = await env.DB.prepare(
      'SELECT use_count FROM registration_invites WHERE id = ?',
    ).bind(inviteId).first<{ use_count: number }>();
    expect(invite).toEqual({ use_count: 1 });
    await expect(env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(second.email).first()).resolves.toBeNull();
  });

  it('assigns the configured bootstrap email the administrator role', async () => {
    const account = accountValues('bootstrap');
    const sent: SentCode[] = [];
    const bindings = mailBindings(sent, { BOOTSTRAP_ADMIN_EMAIL: account.email });
    const start = await request('/api/auth/register/start', {
      email: account.email,
      password: 'correct-password',
      name: account.name,
    }, bindings);
    const body = await start.json() as { challengeId: string };
    const verify = await request('/api/auth/register/verify', {
      challengeId: body.challengeId,
      code: sent[0]?.code,
    }, bindings);
    expect(verify.status).toBe(201);
    const response = await verify.json() as { user: { id: string; role: string } };
    expect(response.user.role).toBe('admin');
    await expect(env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(response.user.id).first())
      .resolves.toEqual({ role: 'admin' });
  });
});

describe('unverified login rejection', () => {
  it('uses generic login failures for an account whose email is not verified', async () => {
    const account = accountValues('legacy');
    const userId = crypto.randomUUID();
    const profileId = crypto.randomUUID().replaceAll('-', '');
    const salt = 'salt-' + userId;
    const now = Date.now();
    const userInsert =
      'INSERT INTO users ' +
      '(id, email, password, salt, role, created_at, updated_at, default_profile_id, email_verified_at, status) ' +
      'VALUES (?, ?, ?, ?, \'user\', ?, ?, NULL, NULL, \'active\')';
    const profileInsert =
      'INSERT INTO profiles ' +
      '(id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at) ' +
      'VALUES (?, ?, ?, NULL, NULL, \'classic\', ?, ?)';
    await env.DB.batch([
      env.DB.prepare(userInsert).bind(
        userId,
        account.email,
        await hashPassword('correct-password', salt),
        salt,
        now,
        now,
      ),
      env.DB.prepare(profileInsert).bind(profileId, userId, account.name, now, now),
      env.DB.prepare('UPDATE users SET default_profile_id = ? WHERE id = ?').bind(profileId, userId),
    ]);

    const webLogin = await request('/api/auth/login', {
      email: account.email,
      password: 'correct-password',
    }, { ...env });
    expect(webLogin.status).toBe(401);
    await expect(webLogin.json()).resolves.toEqual({
      error: 'Unauthorized',
      errorMessage: 'Invalid email or password.',
      errorCode: 'unauthorized',
    });

    const yggLogin = await request('/authserver/authenticate', {
      username: account.email,
      password: 'correct-password',
    }, { ...env });
    expect(yggLogin.status).toBe(403);
    await expect(yggLogin.json()).resolves.toEqual({
      error: 'ForbiddenOperationException',
      errorMessage: 'Invalid credentials. Invalid username or password.',
    });
  });
});
