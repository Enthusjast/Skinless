import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import type { ProfileRecord, UserRecord } from '../src/types';

class PublicProfileStatement {
  private values: unknown[] = [];

  public constructor(private readonly database: PublicProfileDatabase, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve(this.database.first(this.sql, this.values) as T | null);
  }
}

class PublicProfileDatabase {
  public constructor(
    private readonly profile: ProfileRecord,
    private readonly userStatus: UserRecord['status'] = 'active',
  ) {}

  prepare(sql: string): PublicProfileStatement {
    return new PublicProfileStatement(this, sql.replace(/\s+/g, ' ').trim());
  }

  first(sql: string, values: unknown[]): ProfileRecord | null {
    if (sql.includes('WHERE id = ?')) {
      return this.userStatus === 'active' && values[0] === this.profile.id ? { ...this.profile } : null;
    }
    if (sql.includes('WHERE name = ? COLLATE NOCASE')) {
      return this.userStatus === 'active' && String(values[0]).toLowerCase() === this.profile.name.toLowerCase()
        ? { ...this.profile }
        : null;
    }
    return null;
  }
}

const profileId = 'a'.repeat(32);
const profile: ProfileRecord = {
  id: profileId,
  user_id: 'account-secret-id',
  name: 'PlayerOne',
  skin_hash: 'b'.repeat(64),
  cape_hash: 'c'.repeat(64),
  skin_model: 'slim',
};

function environment(userStatus: UserRecord['status'] = 'active') {
  return {
    DB: new PublicProfileDatabase(profile, userStatus) as unknown as D1Database,
    BUCKET: {},
    API_BASE_URL: 'https://skin.example.com',
  };
}

describe('public profile API', () => {
  it('returns only the shareable profile projection and protocol-safe texture URLs', async () => {
    const response = await app.request(`/api/public/profiles/${profileId}`, {}, environment());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: profileId,
      name: 'PlayerOne',
      model: 'slim',
      skin: {
        url: `https://skin.example.com/textures/${profile.skin_hash}`,
        metadata: { model: 'slim' },
      },
      cape: { url: `https://skin.example.com/textures/${profile.cape_hash}` },
    });
    const body = await (await app.request(`/api/public/profiles/${profileId}`, {}, environment())).text();
    expect(body).not.toContain('account-secret-id');
    expect(body).not.toContain('email');
    expect(body).not.toContain('role');
    expect(body).not.toContain('session');
  });

  it('uses 404 for an unknown UUID and 204 for a missing case-insensitive name', async () => {
    const unknownUuid = await app.request(`/api/public/profiles/${'d'.repeat(32)}`, {}, environment());
    expect(unknownUuid.status).toBe(404);

    const foundByName = await app.request('/api/public/profiles/name/pLaYeRoNe', {}, environment());
    expect(foundByName.status).toBe(200);
    await expect(foundByName.json()).resolves.toMatchObject({ id: profileId, name: profile.name });

    const missingByName = await app.request('/api/public/profiles/name/UnknownPlayer', {}, environment());
    expect(missingByName.status).toBe(204);
    expect(await missingByName.text()).toBe('');
  });

  it('does not publish profiles belonging to inactive accounts', async () => {
    const response = await app.request(`/api/public/profiles/${profileId}`, {}, environment('disabled'));

    expect(response.status).toBe(404);
  });
});
