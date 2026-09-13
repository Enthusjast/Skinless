import { deleteAuditLogsBefore } from './db/queries';

export const AUDIT_LOG_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
export const AUDIT_LOG_CLEANUP_BATCH_SIZE = 100;

export interface AuditLogCleanupStats {
  deleted: number;
}

export async function processAuditLogCleanup(
  db: D1Database,
  now = Date.now(),
): Promise<AuditLogCleanupStats> {
  return {
    deleted: await deleteAuditLogsBefore(
      db,
      now - AUDIT_LOG_RETENTION_MS,
      AUDIT_LOG_CLEANUP_BATCH_SIZE,
    ),
  };
}
