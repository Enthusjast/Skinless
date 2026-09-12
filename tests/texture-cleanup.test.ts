import { describe, expect, it } from 'vitest';
import {
  cancelTextureCleanup,
  processTextureCleanup,
  scheduleTextureCleanup,
  TEXTURE_CLEANUP_BATCH_SIZE,
  TEXTURE_CLEANUP_DELAY_MS,
  type TextureCleanupRecord,
} from '../src/texture-cleanup';

type Row = Record<string, unknown>;

class CleanupStatement {
  private values: unknown[] = [];

  public constructor(private readonly database: CleanupDatabase, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve(this.database.first(this.sql, this.values) as T | null);
  }

  all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({ results: this.database.all(this.sql, this.values) as T[] });
  }

  run(): Promise<{ success: true; meta: { changes: number } }> {
    return Promise.resolve({ success: true, meta: { changes: this.database.run(this.sql, this.values) } });
  }
}

class CleanupDatabase {
  public readonly profileReferences = new Map<string, number>();
  public readonly wardrobeReferences = new Map<string, number>();
  public readonly cleanups = new Map<string, TextureCleanupRecord>();

  prepare(sql: string): CleanupStatement {
    return new CleanupStatement(this, sql.replace(/\s+/g, ' ').trim());
  }

  first(sql: string, values: unknown[]): Row | null {
    if (sql.startsWith('SELECT COUNT(*) AS count FROM profiles')) {
      return { count: this.profileReferences.get(String(values[0])) ?? 0 };
    }
    if (sql.startsWith('SELECT COUNT(*) AS count FROM texture_wardrobe')) {
      return { count: this.wardrobeReferences.get(String(values[0])) ?? 0 };
    }
    return null;
  }

  all(sql: string, values: unknown[]): Row[] {
    if (!sql.startsWith('SELECT hash, object_key, scheduled_at, attempts, last_error FROM texture_cleanup')) {
      return [];
    }
    const now = Number(values[0]);
    const limit = Number(values[1]);
    return [...this.cleanups.values()]
      .filter((row) => row.scheduled_at <= now)
      .sort((left, right) => left.scheduled_at - right.scheduled_at || left.hash.localeCompare(right.hash))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  run(sql: string, values: unknown[]): number {
    if (sql.startsWith('INSERT INTO texture_cleanup')) {
      const [hash, objectKey, scheduledAt] = values.map(String);
      if (this.cleanups.has(hash)) return 0;
      this.cleanups.set(hash, {
        hash,
        object_key: objectKey,
        scheduled_at: Number(scheduledAt),
        attempts: 0,
        last_error: null,
      });
      return 1;
    }
    if (sql.startsWith('DELETE FROM texture_cleanup WHERE hash = ?')) {
      return this.cleanups.delete(String(values[0])) ? 1 : 0;
    }
    if (sql.startsWith('UPDATE texture_cleanup SET attempts = attempts + 1')) {
      const row = this.cleanups.get(String(values[1]));
      if (!row) return 0;
      row.attempts += 1;
      row.last_error = String(values[0]);
      return 1;
    }
    return 0;
  }
}

class CleanupBucket {
  public readonly deleted: string[] = [];
  public fail = false;

  async delete(key: string): Promise<void> {
    if (this.fail) throw new Error('R2 unavailable');
    this.deleted.push(key);
  }
}

function database(): CleanupDatabase {
  return new CleanupDatabase();
}

describe('deferred texture cleanup', () => {
  it('schedules an unreferenced hash exactly seven days in the future', async () => {
    const db = database();
    const now = 1_000_000;

    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-a', now);

    expect(db.cleanups.get('hash-a')).toEqual({
      hash: 'hash-a',
      object_key: 'hash-a.png',
      scheduled_at: now + TEXTURE_CLEANUP_DELAY_MS,
      attempts: 0,
      last_error: null,
    });
  });

  it('cancels pending cleanup when a hash becomes referenced again', async () => {
    const db = database();
    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-b', 2_000_000);
    db.profileReferences.set('hash-b', 1);

    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-b', 2_000_001);

    expect(db.cleanups.has('hash-b')).toBe(false);
    await cancelTextureCleanup(db as unknown as D1Database, 'hash-b');
  });

  it('does not delete before the seven-day threshold and deletes at the threshold', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 3_000_000;
    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-c', now);

    await processTextureCleanup(db as unknown as D1Database, bucket as unknown as R2Bucket, now + TEXTURE_CLEANUP_DELAY_MS - 1);
    expect(bucket.deleted).toEqual([]);
    expect(db.cleanups.has('hash-c')).toBe(true);

    await processTextureCleanup(db as unknown as D1Database, bucket as unknown as R2Bucket, now + TEXTURE_CLEANUP_DELAY_MS);
    expect(bucket.deleted).toEqual(['hash-c.png']);
    expect(db.cleanups.has('hash-c')).toBe(false);
  });

  it('processes at most the bounded cleanup batch', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 4_000_000;
    for (let index = 0; index < TEXTURE_CLEANUP_BATCH_SIZE + 2; index += 1) {
      await scheduleTextureCleanup(db as unknown as D1Database, `hash-${index}`, now);
    }

    await processTextureCleanup(db as unknown as D1Database, bucket as unknown as R2Bucket, now + TEXTURE_CLEANUP_DELAY_MS);

    expect(bucket.deleted).toHaveLength(TEXTURE_CLEANUP_BATCH_SIZE);
    expect(db.cleanups.size).toBe(2);
  });

  it('keeps a failed deletion queued and retries it later', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 5_000_000;
    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-e', now);
    bucket.fail = true;

    await processTextureCleanup(db as unknown as D1Database, bucket as unknown as R2Bucket, now + TEXTURE_CLEANUP_DELAY_MS);

    expect(db.cleanups.get('hash-e')).toMatchObject({ attempts: 1, last_error: 'R2 unavailable' });
    expect(bucket.deleted).toEqual([]);

    bucket.fail = false;
    await processTextureCleanup(db as unknown as D1Database, bucket as unknown as R2Bucket, now + TEXTURE_CLEANUP_DELAY_MS + 1);

    expect(bucket.deleted).toEqual(['hash-e.png']);
    expect(db.cleanups.has('hash-e')).toBe(false);
  });

  it('removes a due queue row without deleting while the hash is referenced', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 6_000_000;
    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-f', now);
    db.wardrobeReferences.set('hash-f', 1);

    await processTextureCleanup(db as unknown as D1Database, bucket as unknown as R2Bucket, now + TEXTURE_CLEANUP_DELAY_MS);

    expect(bucket.deleted).toEqual([]);
    expect(db.cleanups.has('hash-f')).toBe(false);
  });
});
