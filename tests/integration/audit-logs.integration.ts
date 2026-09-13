import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { app } from '../../src/index';
import { recordAuditLog } from '../../src/audit';
import { registerVerifiedAccount } from './verified-registration-fixture';

interface Client {
  userId: string;
  accessToken: string;
}

const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

async function createClient(role: 'user' | 'admin' = 'user'): Promise<Client> {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `audit-${suffix}@example.com`;
  const account = await registerVerifiedAccount(email, 'correct-password', `Audit${suffix.slice(0, 10)}`);
  if (role === 'admin') {
    await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind('admin', account.id).run();
  }

  const response = await SELF.fetch('https://worker.test/authserver/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: email,
      password: 'correct-password',
      clientToken: `audit-client-${suffix}`,
    }),
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { accessToken: string };
  return { userId: account.id, accessToken: body.accessToken };
}

function request(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return SELF.fetch(`https://worker.test${path}`, { ...init, headers });
}

function jsonRequest(
  path: string,
  accessToken: string,
  method: string,
  body: unknown,
  requestId = crypto.randomUUID(),
): Promise<Response> {
  return request(path, accessToken, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
    body: JSON.stringify(body),
  });
}

describe('administrator audit logs against real D1', () => {
  it('records a password reset without storing the verification code', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const email = `audit-reset-${suffix}@example.com`;
    const account = await registerVerifiedAccount(
      email,
      'correct-password',
      `Reset${suffix.slice(0, 10)}`,
    );
    let code = '';
    const bindings = {
      ...env,
      MAIL_SENDER: {
        async sendPasswordResetCode(_email: string, nextCode: string) {
          code = nextCode;
        },
      },
    };
    const start = await app.request(
      'https://worker.test/api/auth/password/reset/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      },
      bindings as never,
    );
    expect(start.status).toBe(202);
    const challenge = await start.json() as { challengeId: string };
    const verify = await app.request(
      'https://worker.test/api/auth/password/reset/verify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          code,
          newPassword: 'new-correct-password',
        }),
      },
      bindings as never,
    );
    expect(verify.status).toBe(204);

    const admin = await createClient('admin');
    const logs = await request(
      `/api/admin/audit-logs?action=account.password.reset&targetUserId=${account.id}&limit=10`,
      admin.accessToken,
    );
    expect(logs.status).toBe(200);
    const body = await logs.json() as { logs: Array<Record<string, unknown>> };
    expect(body.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'account.password.reset',
        actorUserId: null,
        targetUserId: account.id,
      }),
    ]));
    expect(JSON.stringify(body.logs)).not.toContain(code);
  });

  it('records admin actions without exposing invite secrets or sensitive metadata', async () => {
    const admin = await createClient('admin');
    const target = await createClient();

    const status = await jsonRequest(
      `/api/admin/users/${target.userId}/status`,
      admin.accessToken,
      'PATCH',
      { status: 'disabled', confirmation: 'DISABLE' },
      `audit-status-${crypto.randomUUID()}`,
    );
    expect(status.status).toBe(200);

    const invite = await jsonRequest(
      '/api/admin/invites',
      admin.accessToken,
      'POST',
      { useLimit: 2, note: 'do not copy this into the audit log' },
      `audit-invite-${crypto.randomUUID()}`,
    );
    expect(invite.status).toBe(201);
    const inviteBody = await invite.json() as { invite: { id: string; code: string } };

    const settings = await jsonRequest(
      '/api/admin/settings',
      admin.accessToken,
      'PATCH',
      { registrationMode: 'invite' },
      `audit-settings-${crypto.randomUUID()}`,
    );
    expect(settings.status).toBe(200);

    const logsResponse = await request(
      `/api/admin/audit-logs?actorUserId=${encodeURIComponent(admin.userId)}&limit=100`,
      admin.accessToken,
    );
    expect(logsResponse.status).toBe(200);
    const body = await logsResponse.json() as {
      logs: Array<Record<string, unknown>>;
    };
    const actions = body.logs.map((log) => log.action);
    expect(actions).toContain('admin.user.status.update');
    expect(actions).toContain('admin.invite.create');
    expect(actions).toContain('admin.settings.update');
    expect(actions).toContain('admin.registration_mode.update');
    expect(JSON.stringify(body.logs)).not.toContain(inviteBody.invite.code);
    expect(body.logs.find((log) => log.action === 'admin.invite.create')).toMatchObject({
      targetResource: `invite:${inviteBody.invite.id}`,
      result: 'success',
    });
  });

  it('supports stable pagination, action/actor/target/date filters, and rejects non-admins', async () => {
    const admin = await createClient('admin');
    const target = await createClient();

    const disable = await jsonRequest(
      `/api/admin/users/${target.userId}/status`,
      admin.accessToken,
      'PATCH',
      { status: 'disabled', confirmation: 'DISABLE' },
      `audit-page-disable-${crypto.randomUUID()}`,
    );
    expect(disable.status).toBe(200);
    const enable = await jsonRequest(
      `/api/admin/users/${target.userId}/status`,
      admin.accessToken,
      'PATCH',
      { status: 'active' },
      `audit-page-enable-${crypto.randomUUID()}`,
    );
    expect(enable.status).toBe(200);

    const now = Date.now();
    const pageResponse = await request(
      `/api/admin/audit-logs?action=admin.user.status.update&actorUserId=${admin.userId}&targetUserId=${target.userId}&from=${now - 60_000}&to=${now + 60_000}&limit=1&offset=0`,
      admin.accessToken,
    );
    expect(pageResponse.status).toBe(200);
    const page = await pageResponse.json() as {
      logs: Array<{ createdAt: number; targetUserId: string | null }>;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
    expect(page).toMatchObject({ limit: 1, offset: 0, hasMore: true });
    expect(page.logs).toHaveLength(1);
    expect(page.logs[0]?.targetUserId).toBe(target.userId);

    const targetPage = await request(
      `/api/admin/audit-logs?target=${encodeURIComponent(target.userId)}&limit=10`,
      admin.accessToken,
    );
    expect(targetPage.status).toBe(200);
    await expect(targetPage.json()).resolves.toMatchObject({
      logs: expect.arrayContaining([
        expect.objectContaining({ targetUserId: target.userId }),
      ]),
    });

    const regularUser = await createClient();
    const forbidden = await request('/api/admin/audit-logs', regularUser.accessToken);
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ errorCode: 'forbidden' });
  });

  it('keeps actor and target references nullable when users are deleted', async () => {
    const admin = await createClient('admin');
    const target = await createClient();
    const actorToDelete = await createClient();

    await recordAuditLog(env.DB, {
      id: `audit-nullable-${crypto.randomUUID()}`,
      actorUserId: actorToDelete.userId,
      targetUserId: target.userId,
      targetResource: 'resource:nullable',
      action: 'test.nullable.references',
      result: 'success',
      requestId: `audit-nullable-request-${crypto.randomUUID()}`,
    });

    const deleted = await jsonRequest(
      `/api/admin/users/${target.userId}`,
      admin.accessToken,
      'DELETE',
      { confirmation: 'DELETE' },
    );
    expect(deleted.status).toBe(204);
    const deletedActor = await jsonRequest(
      `/api/admin/users/${actorToDelete.userId}`,
      admin.accessToken,
      'DELETE',
      { confirmation: 'DELETE' },
    );
    expect(deletedActor.status).toBe(204);

    const row = await env.DB.prepare(
      'SELECT actor_user_id, target_user_id FROM audit_logs WHERE action = ? LIMIT 1',
    ).bind('test.nullable.references').first();
    expect(row).toEqual({ actor_user_id: null, target_user_id: null });

    const deleteLog = await request(
      `/api/admin/audit-logs?action=admin.user.delete&limit=100`,
      admin.accessToken,
    );
    const deleteBody = await deleteLog.json() as { logs: Array<Record<string, unknown>> };
    expect(deleteBody.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'admin.user.delete',
        targetUserId: null,
        targetResource: `user:${target.userId}`,
      }),
    ]));
  });

  it('does not fail a successful admin operation when audit insertion fails', async () => {
    const admin = await createClient('admin');
    const trigger = `audit_failure_${crypto.randomUUID().replaceAll('-', '')}`;
    await env.DB.prepare(
      `CREATE TRIGGER ${trigger}
       BEFORE INSERT ON audit_logs
       BEGIN SELECT RAISE(ABORT, 'audit insert failed'); END`,
    ).run();

    try {
      const response = await jsonRequest(
        '/api/admin/settings',
        admin.accessToken,
        'PATCH',
        { registrationMode: 'open' },
        `audit-trigger-${crypto.randomUUID()}`,
      );
      expect(response.status).toBe(200);
      await expect(env.DB.prepare('SELECT registration_mode FROM site_settings WHERE id = 1').first())
        .resolves.toEqual({ registration_mode: 'open' });
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${trigger}`).run();
    }
  });

  it('removes at most one retention batch of logs older than 180 days', async () => {
    const prefix = `audit-retention-${crypto.randomUUID()}`;
    const oldCreatedAt = Date.now() - AUDIT_RETENTION_MS - 60_000;
    const statements = Array.from({ length: 101 }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, target_user_id, target_resource, action, result, request_id, metadata, created_at)
         VALUES (?, NULL, NULL, NULL, 'test.retention', 'success', ?, '{}', ?)`,
      ).bind(`${prefix}-${index}`, `${prefix}-request-${index}`, oldCreatedAt + index),
    );
    await env.DB.batch(statements);

    await worker.scheduled?.({} as ScheduledController, env, {} as ExecutionContext);
    const afterFirstRun = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'test.retention'",
    ).first<{ count: number }>();
    expect(Number(afterFirstRun?.count)).toBe(1);

    await worker.scheduled?.({} as ScheduledController, env, {} as ExecutionContext);
    const afterSecondRun = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'test.retention'",
    ).first<{ count: number }>();
    expect(Number(afterSecondRun?.count)).toBe(0);
  });
});
