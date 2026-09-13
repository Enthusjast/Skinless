export type AuditResult = 'success' | 'failure';

export const AUDIT_ACTIONS = {
  ADMIN_USER_ROLE_UPDATE: 'admin.user.role.update',
  ADMIN_USER_STATUS_UPDATE: 'admin.user.status.update',
  ADMIN_USER_SESSIONS_REVOKE: 'admin.user.sessions.revoke',
  ADMIN_USER_DELETE: 'admin.user.delete',
  ADMIN_INVITE_CREATE: 'admin.invite.create',
  ADMIN_INVITE_REVOKE: 'admin.invite.revoke',
  ADMIN_SETTINGS_UPDATE: 'admin.settings.update',
  ADMIN_REGISTRATION_MODE_UPDATE: 'admin.registration_mode.update',
  ACCOUNT_DELETION_REQUEST: 'account.deletion.request',
  ACCOUNT_DELETION_RESTORE: 'account.deletion.restore',
  ACCOUNT_DELETION_FINALIZE: 'account.deletion.finalize',
  ACCOUNT_PASSWORD_CHANGE: 'account.password.change',
  ACCOUNT_PASSWORD_RESET: 'account.password.reset',
  ACCOUNT_EMAIL_CHANGE: 'account.email.change',
} as const;

export interface AuditLogEvent {
  id?: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  targetResource?: string | null;
  action: string;
  result: AuditResult;
  requestId?: string | null;
  metadata?: unknown;
  createdAt?: number;
}

type SafeJsonValue = string | number | boolean | null | SafeJsonValue[] | { [key: string]: SafeJsonValue };

const SENSITIVE_METADATA_KEY = /(?:password|salt|token|code|ip|useragent|authorization|cookie|secret)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJsonValue(value: unknown): SafeJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => safeJsonValue(entry))
      .filter((entry): entry is SafeJsonValue => entry !== undefined);
  }
  if (!isRecord(value)) return undefined;

  const result: { [key: string]: SafeJsonValue } = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_METADATA_KEY.test(key.replace(/[^a-z0-9]/gi, ''))) continue;
    const safeEntry = safeJsonValue(entry);
    if (safeEntry !== undefined) result[key] = safeEntry;
  }
  return result;
}

export function sanitizeAuditMetadata(value: unknown): Record<string, SafeJsonValue> {
  const safeValue = safeJsonValue(value);
  return isRecord(safeValue) ? safeValue as Record<string, SafeJsonValue> : {};
}

export function requestIdFromRequest(request: Request): string {
  const candidate = request.headers.get('X-Request-ID')?.trim();
  if (candidate && candidate.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(candidate)) {
    return candidate;
  }
  return crypto.randomUUID();
}

export async function recordAuditLog(
  db: D1Database,
  event: AuditLogEvent,
): Promise<void> {
  const requestId = event.requestId?.trim() || crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, target_user_id, target_resource, action, result, request_id, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id ?? crypto.randomUUID(),
        event.actorUserId ?? null,
        event.targetUserId ?? null,
        event.targetResource ?? null,
        event.action,
        event.result,
        requestId,
        JSON.stringify(sanitizeAuditMetadata(event.metadata)),
        event.createdAt ?? Date.now(),
      )
      .run();
  } catch (error) {
    console.error('[audit] failed to write audit log', {
      action: event.action,
      result: event.result,
      requestId,
      reason: error instanceof Error ? error.message : 'unknown error',
    });
  }
}
