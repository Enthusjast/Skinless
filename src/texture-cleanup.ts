import { countAssetReferences } from './db/queries';

export const TEXTURE_CLEANUP_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export const TEXTURE_CLEANUP_BATCH_SIZE = 100;

export interface TextureCleanupRecord {
  hash: string;
  object_key: string;
  scheduled_at: number;
  attempts: number;
  last_error: string | null;
}

export interface TextureCleanupStats {
  processed: number;
  deleted: number;
  cancelled: number;
  failed: number;
}

export async function cancelTextureCleanup(db: D1Database, hash: string): Promise<void> {
  await db.prepare('DELETE FROM texture_cleanup WHERE hash = ?').bind(hash).run();
}

export async function scheduleTextureCleanup(db: D1Database, hash: string, now = Date.now()): Promise<void> {
  if (await countAssetReferences(db, hash) > 0) {
    await cancelTextureCleanup(db, hash);
    return;
  }

  await db
    .prepare(
      `INSERT INTO texture_cleanup (hash, object_key, scheduled_at, attempts, last_error)
       VALUES (?, ?, ?, 0, NULL)
       ON CONFLICT (hash) DO NOTHING`,
    )
    .bind(hash, `${hash}.png`, now + TEXTURE_CLEANUP_DELAY_MS)
    .run();
}

async function listDueTextureCleanup(db: D1Database, now: number): Promise<TextureCleanupRecord[]> {
  const result = await db
    .prepare(
      `SELECT hash, object_key, scheduled_at, attempts, last_error
       FROM texture_cleanup
       WHERE scheduled_at <= ?
       ORDER BY scheduled_at ASC, hash ASC
       LIMIT ?`,
    )
    .bind(now, TEXTURE_CLEANUP_BATCH_SIZE)
    .all<TextureCleanupRecord>();
  return result.results;
}

async function completeTextureCleanup(db: D1Database, hash: string): Promise<void> {
  await cancelTextureCleanup(db, hash);
}

async function recordTextureCleanupFailure(db: D1Database, hash: string, error: string): Promise<void> {
  await db
    .prepare(
      `UPDATE texture_cleanup
       SET attempts = attempts + 1, last_error = ?
       WHERE hash = ?`,
    )
    .bind(error, hash)
    .run();
}

function cleanupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}

export async function processTextureCleanup(
  db: D1Database,
  bucket: R2Bucket,
  now = Date.now(),
): Promise<TextureCleanupStats> {
  const due = await listDueTextureCleanup(db, now);
  const stats: TextureCleanupStats = {
    processed: 0,
    deleted: 0,
    cancelled: 0,
    failed: 0,
  };

  for (const cleanup of due) {
    stats.processed += 1;
    try {
      if (await countAssetReferences(db, cleanup.hash) > 0) {
        await completeTextureCleanup(db, cleanup.hash);
        stats.cancelled += 1;
        continue;
      }

      await bucket.delete(cleanup.object_key);
      await completeTextureCleanup(db, cleanup.hash);
      stats.deleted += 1;
    } catch (error) {
      const message = cleanupError(error);
      await recordTextureCleanupFailure(db, cleanup.hash, message);
      stats.failed += 1;
      console.error('[texture-cleanup] deletion failed', {
        attempts: cleanup.attempts + 1,
        error: message,
        hash: cleanup.hash,
      });
    }
  }

  console.info('[texture-cleanup] batch complete', stats);
  return stats;
}
