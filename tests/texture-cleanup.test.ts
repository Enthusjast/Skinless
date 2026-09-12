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
  public onComplete: ((hash: string) => void) | undefined;

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
    if (sql.startsWith('SELECT hash, object_key, scheduled_at, attempts, last_error FROM texture_cleanup')) {
      const hash = String(values[0]);
      const row = this.cleanups.get(hash);
      const referenced = (this.profileReferences.get(hash) ?? 0) + (this.wardrobeReferences.get(hash) ?? 0) > 0;
      if (!row || row.scheduled_at > Number(values[1]) || referenced) return null;
      return { ...row };
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
    if (sql.startsWith('UPDATE texture_cleanup SET scheduled_at = ?')) {
      const [nextScheduledAt, error, hashValue, scheduledAtValue] = values;
      const row = this.cleanups.get(String(hashValue));
      if (!row || row.scheduled_at !== Number(scheduledAtValue)) return 0;
      row.scheduled_at = Number(nextScheduledAt);
      row.attempts += 1;
      row.last_error = String(error);
      return 1;
    }
    if (sql.startsWith('DELETE FROM texture_cleanup WHERE hash = ? AND NOT EXISTS')) {
      const hash = String(values[0]);
      this.onComplete?.(hash);
      const referenced = (this.profileReferences.get(hash) ?? 0) + (this.wardrobeReferences.get(hash) ?? 0) > 0;
      return referenced && this.cleanups.has(hash) ? 0 : this.cleanups.delete(hash) ? 1 : 0;
    }
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
    if (sql.startsWith('DELETE FROM texture_cleanup WHERE hash = ? AND (EXISTS')) {
      const hash = String(values[0]);
      const referenced = (this.profileReferences.get(hash) ?? 0) + (this.wardrobeReferences.get(hash) ?? 0) > 0;
      return referenced && this.cleanups.delete(hash) ? 1 : 0;
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
  public readonly files = new Map<string, Uint8Array>();
  public getCalls = 0;
  public fail = false;
  public failPut = false;
  public failAfterDelete = false;
  public onGet: ((key: string) => void) | undefined;
  public onDelete: ((key: string) => void) | undefined;

  async get(key: string): Promise<R2ObjectBody | null> {
    this.getCalls += 1;
    const bytes = this.files.get(key);
    this.onGet?.(key);
    if (!bytes) return null;
    return {
      arrayBuffer: async () => bytes.slice().buffer,
    } as R2ObjectBody;
  }

  async put(key: string, body: BodyInit): Promise<R2Object> {
    if (this.failPut) throw new Error('R2 restore unavailable');
    this.files.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
    return { key } as R2Object;
  }

  async delete(key: string): Promise<void> {
    if (this.fail) throw new Error('R2 unavailable');
    this.deleted.push(key);
    this.files.delete(key);
    this.onDelete?.(key);
    if (this.failAfterDelete) throw new Error('Worker crashed before cleanup completion');
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

  it('retains the cleanup row when a worker fails after deleting R2 before completion', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 6_500_000;
    const hash = 'hash-crash-before-completion';
    const dueAt = now + TEXTURE_CLEANUP_DELAY_MS;
    bucket.files.set(`${hash}.png`, Uint8Array.from([13, 14, 15, 16]));
    bucket.failAfterDelete = true;
    await scheduleTextureCleanup(db as unknown as D1Database, hash, now);

    const failed = await processTextureCleanup(
      db as unknown as D1Database,
      bucket as unknown as R2Bucket,
      dueAt,
    );

    expect(failed).toMatchObject({ processed: 1, deleted: 0, cancelled: 0, failed: 1 });
    expect(bucket.deleted).toEqual([`${hash}.png`]);
    expect(db.cleanups.get(hash)).toMatchObject({
      scheduled_at: dueAt + TEXTURE_CLEANUP_DELAY_MS,
      attempts: 1,
      last_error: 'Worker crashed before cleanup completion',
    });

    bucket.failAfterDelete = false;
    const retry = await processTextureCleanup(
      db as unknown as D1Database,
      bucket as unknown as R2Bucket,
      dueAt + TEXTURE_CLEANUP_DELAY_MS,
    );

    expect(retry).toMatchObject({ processed: 1, deleted: 1, cancelled: 0, failed: 0 });
    expect(db.cleanups.has(hash)).toBe(false);
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
    await processTextureCleanup(db as unknown as D1Database, bucket as unknown as R2Bucket, now + TEXTURE_CLEANUP_DELAY_MS * 2);

    expect(bucket.deleted).toEqual(['hash-e.png']);
    expect(db.cleanups.has('hash-e')).toBe(false);
  });

  it('does not resurrect a rescheduled cleanup after a stale worker failure', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 5_500_000;
    const hash = 'hash-stale-retry';
    const rescheduledNow = now + 1_234;
    await scheduleTextureCleanup(db as unknown as D1Database, hash, now);
    bucket.fail = true;
    bucket.onGet = () => {
      db.cleanups.delete(hash);
      db.cleanups.set(hash, {
        hash,
        object_key: `${hash}.png`,
        scheduled_at: rescheduledNow + TEXTURE_CLEANUP_DELAY_MS,
        attempts: 0,
        last_error: null,
      });
      bucket.onGet = undefined;
    };

    const stats = await processTextureCleanup(
      db as unknown as D1Database,
      bucket as unknown as R2Bucket,
      now + TEXTURE_CLEANUP_DELAY_MS,
    );

    expect(stats).toMatchObject({ processed: 1, deleted: 0, cancelled: 0, failed: 1 });
    expect(db.cleanups.get(hash)).toEqual({
      hash,
      object_key: `${hash}.png`,
      scheduled_at: rescheduledNow + TEXTURE_CLEANUP_DELAY_MS,
      attempts: 0,
      last_error: null,
    });
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

  it('restores cached bytes when a reference appears during deletion', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 7_000_000;
    const originalBytes = Uint8Array.from([1, 2, 3, 4]);
    bucket.files.set('hash-race.png', originalBytes);
    bucket.onDelete = () => db.profileReferences.set('hash-race', 1);
    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-race', now);

    const stats = await processTextureCleanup(
      db as unknown as D1Database,
      bucket as unknown as R2Bucket,
      now + TEXTURE_CLEANUP_DELAY_MS,
    );

    expect(stats).toMatchObject({ processed: 1, deleted: 0, cancelled: 1, failed: 0 });
    expect(bucket.files.get('hash-race.png')).toEqual(originalBytes);
    expect(db.cleanups.has('hash-race')).toBe(false);
  });

  it('retains a retry row when restoring a referenced object fails', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 7_500_000;
    const originalBytes = Uint8Array.from([5, 6, 7, 8]);
    bucket.files.set('hash-restore-failure.png', originalBytes);
    bucket.onDelete = () => db.profileReferences.set('hash-restore-failure', 1);
    bucket.failPut = true;
    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-restore-failure', now);

    const failed = await processTextureCleanup(
      db as unknown as D1Database,
      bucket as unknown as R2Bucket,
      now + TEXTURE_CLEANUP_DELAY_MS,
    );

    expect(failed).toMatchObject({ processed: 1, deleted: 0, cancelled: 0, failed: 1 });
    expect(db.cleanups.get('hash-restore-failure')).toMatchObject({
      attempts: 1,
      last_error: 'R2 restore unavailable',
    });

    const retry = await processTextureCleanup(
      db as unknown as D1Database,
      bucket as unknown as R2Bucket,
      now + TEXTURE_CLEANUP_DELAY_MS * 2,
    );

    expect(retry).toMatchObject({ processed: 1, deleted: 0, cancelled: 1, failed: 0 });
    expect(bucket.deleted).toEqual(['hash-restore-failure.png']);
    expect(db.cleanups.has('hash-restore-failure')).toBe(false);
  });

  it('restores cached bytes when the final queue-row recheck loses a reference race', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 7_750_000;
    const originalBytes = Uint8Array.from([9, 10, 11, 12]);
    bucket.files.set('hash-final-race.png', originalBytes);
    db.onComplete = () => db.profileReferences.set('hash-final-race', 1);
    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-final-race', now);

    const stats = await processTextureCleanup(
      db as unknown as D1Database,
      bucket as unknown as R2Bucket,
      now + TEXTURE_CLEANUP_DELAY_MS,
    );

    expect(stats).toMatchObject({ processed: 1, deleted: 0, cancelled: 1, failed: 0 });
    expect(bucket.files.get('hash-final-race.png')).toEqual(originalBytes);
    expect(db.cleanups.has('hash-final-race')).toBe(false);
  });

  it('treats an already-missing object as an idempotent deletion', async () => {
    const db = database();
    const bucket = new CleanupBucket();
    const now = 8_000_000;
    await scheduleTextureCleanup(db as unknown as D1Database, 'hash-missing', now);

    const stats = await processTextureCleanup(
      db as unknown as D1Database,
      bucket as unknown as R2Bucket,
      now + TEXTURE_CLEANUP_DELAY_MS,
    );

    expect(bucket.getCalls).toBe(1);
    expect(stats).toMatchObject({ processed: 1, deleted: 1, cancelled: 0, failed: 0 });
    expect(db.cleanups.has('hash-missing')).toBe(false);
  });
});
