import {
  deleteExpiredPendingAccount,
  listExpiredPendingDeletions,
} from './db/queries';
import { TEXTURE_CLEANUP_DELAY_MS } from './texture-cleanup';
import { AUDIT_ACTIONS, recordAuditLog } from './audit';

export const ACCOUNT_DELETION_BATCH_SIZE = 100;

export interface AccountDeletionCleanupStats {
  scanned: number;
  deleted: number;
  skipped: number;
}

export async function processExpiredAccountDeletions(
  db: D1Database,
  now = Date.now(),
): Promise<AccountDeletionCleanupStats> {
  const candidates = await listExpiredPendingDeletions(
    db,
    now,
    ACCOUNT_DELETION_BATCH_SIZE,
  );
  const stats: AccountDeletionCleanupStats = {
    scanned: candidates.length,
    deleted: 0,
    skipped: 0,
  };
  const requestId = `cron:account-deletion:${now}`;

  for (const candidate of candidates) {
    const deleted = await deleteExpiredPendingAccount(
      db,
      candidate.id,
      now,
      now + TEXTURE_CLEANUP_DELAY_MS,
    );
    if (deleted) {
      stats.deleted += 1;
      await recordAuditLog(db, {
        actorUserId: null,
        targetUserId: null,
        targetResource: `user:${candidate.id}`,
        action: AUDIT_ACTIONS.ACCOUNT_DELETION_FINALIZE,
        result: 'success',
        requestId,
        metadata: { source: 'retention_cron' },
        createdAt: now,
      });
    } else stats.skipped += 1;
  }

  return stats;
}
