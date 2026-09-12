import {
  cancelTextureCleanupIfReferenced as cancelTextureCleanupIfReferencedQuery,
  claimTextureCleanup,
  completeTextureCleanup,
  countAssetReferences,
  retryTextureCleanup,
} from './db/queries';
import type { TextureCleanupRow } from './db/queries';

export const TEXTURE_CLEANUP_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export const TEXTURE_CLEANUP_BATCH_SIZE = 100;

export type TextureCleanupRecord = TextureCleanupRow;

export interface TextureCleanupStats {
  processed: number;
  deleted: number;
  cancelled: number;
  failed: number;
}

export async function cancelTextureCleanup(db: D1Database, hash: string): Promise<void> {
  await db.prepare('DELETE FROM texture_cleanup WHERE hash = ?').bind(hash).run();
}

export async function cancelTextureCleanupIfReferenced(db: D1Database, hash: string): Promise<void> {
  await cancelTextureCleanupIfReferencedQuery(db, hash);
}

export async function scheduleTextureCleanup(db: D1Database, hash: string, now = Date.now()): Promise<void> {
  if (await countAssetReferences(db, hash) > 0) {
    await cancelTextureCleanupIfReferenced(db, hash);
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

function cleanupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}

export interface CachedTextureObject {
  bytes: ArrayBuffer;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

export async function cacheTextureObject(bucket: R2Bucket, objectKey: string): Promise<CachedTextureObject | null> {
  const object = await bucket.get(objectKey);
  if (!object) return null;
  return {
    bytes: await object.arrayBuffer(),
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  };
}

export async function restoreTextureObject(
  bucket: R2Bucket,
  objectKey: string,
  cached: CachedTextureObject,
): Promise<void> {
  await bucket.put(objectKey, cached.bytes, {
    httpMetadata: cached.httpMetadata,
    customMetadata: cached.customMetadata,
  });
}

export async function putTextureObject(bucket: R2Bucket, objectKey: string, bytes: Uint8Array): Promise<void> {
  await bucket.put(objectKey, bytes, {
    httpMetadata: {
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
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

  for (const candidate of due) {
    stats.processed += 1;

    const cleanup = await claimTextureCleanup(db, candidate.hash, now);
    if (!cleanup) {
      if (await countAssetReferences(db, candidate.hash) > 0) {
        await cancelTextureCleanupIfReferenced(db, candidate.hash);
        stats.cancelled += 1;
      }
      continue;
    }

    try {
      const cached = await cacheTextureObject(bucket, cleanup.object_key);
      if (await countAssetReferences(db, cleanup.hash) > 0) {
        await cancelTextureCleanupIfReferenced(db, cleanup.hash);
        stats.cancelled += 1;
        continue;
      }

      await bucket.delete(cleanup.object_key);

      if (await countAssetReferences(db, cleanup.hash) > 0) {
        if (cached) await restoreTextureObject(bucket, cleanup.object_key, cached);
        await cancelTextureCleanupIfReferenced(db, cleanup.hash);
        stats.cancelled += 1;
        continue;
      }

      if (await completeTextureCleanup(db, cleanup.hash)) {
        stats.deleted += 1;
        continue;
      }

      // A reference may have been committed between the final recheck and the
      // conditional queue-row deletion. Restore the cached bytes before
      // acknowledging that cancellation; the reference mutation also
      // re-puts its bytes after committing the D1 reference.
      if (await countAssetReferences(db, cleanup.hash) > 0) {
        if (cached) await restoreTextureObject(bucket, cleanup.object_key, cached);
        await cancelTextureCleanupIfReferenced(db, cleanup.hash);
        stats.cancelled += 1;
        continue;
      }

      // Another cleanup invocation completed the same row after this worker
      // read it. The R2 delete is idempotent, so this invocation is complete.
      stats.deleted += 1;
    } catch (error) {
      const message = cleanupError(error);
      await retryTextureCleanup(db, cleanup, message);
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
