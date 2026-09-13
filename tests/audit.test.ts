import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordAuditLog } from '../src/audit';

class AuditStatement {
  public values: unknown[] = [];

  public constructor(
    private readonly database: AuditDatabase,
    public readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async run(): Promise<{ success: true }> {
    if (this.database.fail) throw new Error('audit database unavailable');
    this.database.statements.push(this);
    return { success: true };
  }
}

class AuditDatabase {
  public readonly statements: AuditStatement[] = [];
  public fail = false;

  prepare(sql: string): AuditStatement {
    return new AuditStatement(this, sql);
  }
}

afterEach(() => vi.restoreAllMocks());

describe('audit log writes', () => {
  it('redacts credential, token, code, network, and user-agent metadata', async () => {
    const db = new AuditDatabase();

    await recordAuditLog(db as unknown as D1Database, {
      actorUserId: 'actor-1',
      targetUserId: 'target-1',
      targetResource: 'user:target-1',
      action: 'admin.user.update',
      result: 'success',
      requestId: 'request-1',
      metadata: {
        safe: 'kept',
        password: 'password-secret',
        salt: 'salt-secret',
        accessToken: 'access-secret',
        refresh_token: 'refresh-secret',
        csrfToken: 'csrf-secret',
        csrf: 'csrf-header-secret',
        code: '123456',
        ip: '192.0.2.1',
        ip_address: '198.51.100.2',
        remote_ip: '198.51.100.3',
        x_forwarded_for: '198.51.100.4',
        userAgent: 'secret browser',
        user_agent: 'another secret browser',
        ua: 'short user-agent alias',
        authorization_header: 'Bearer secret',
        cookie_header: 'session=secret',
        nested: {
          safe: true,
          verificationCode: '654321',
        },
      },
      createdAt: 123,
    });

    const metadata = JSON.parse(String(db.statements[0]?.values[7])) as Record<string, unknown>;
    expect(metadata).toEqual({ safe: 'kept', nested: { safe: true } });
    expect(JSON.stringify(metadata)).not.toContain('password-secret');
    expect(JSON.stringify(metadata)).not.toContain('192.0.2.1');
    expect(db.statements[0]?.sql).toContain('INSERT INTO audit_logs');
  });

  it('preserves safe metadata while redacting network and credential aliases recursively', async () => {
    const db = new AuditDatabase();

    await recordAuditLog(db as unknown as D1Database, {
      action: 'admin.user.delete',
      result: 'success',
      metadata: {
        fromRole: 'admin',
        toRole: 'user',
        actorSnapshot: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
        nested: {
          targetResource: 'user:user-1',
          source: 'admin-api',
          csrf_token: 'csrf-secret',
          userAgentString: 'secret browser',
          clientIpAddress: '192.0.2.5',
          authorizationHeader: 'Bearer secret',
          setCookie: 'session=secret',
        },
      },
    });

    const metadata = JSON.parse(String(db.statements[0]?.values[7])) as Record<string, unknown>;
    expect(metadata).toEqual({
      fromRole: 'admin',
      toRole: 'user',
      actorSnapshot: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
      nested: {
        targetResource: 'user:user-1',
        source: 'admin-api',
      },
    });
  });

  it('isolates a failed audit insert from the primary operation and logs the failure', async () => {
    const db = new AuditDatabase();
    db.fail = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      recordAuditLog(db as unknown as D1Database, {
        action: 'account.password.change',
        result: 'success',
        requestId: 'request-2',
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      '[audit] failed to write audit log',
      expect.objectContaining({ action: 'account.password.change', requestId: 'request-2' }),
    );
  });
});
