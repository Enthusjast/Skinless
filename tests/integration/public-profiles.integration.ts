import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { registerVerifiedAccount } from './verified-registration-fixture';

describe('public profile pages API contract', () => {
  it('redacts account data, resolves names case-insensitively, and preserves missing assets', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
    const account = await registerVerifiedAccount(
      `public-profile-${suffix}@example.com`,
      'correct-password',
      `Public${suffix}`,
    );

    const response = await SELF.fetch(`https://worker.test/api/public/profiles/${account.profile.id}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: account.profile.id,
      name: account.profile.name,
      model: 'classic',
      skin: null,
      cape: null,
    });

    const alias = await SELF.fetch(
      `https://worker.test/api/public/profiles/name/${account.profile.name.toUpperCase()}`,
    );
    expect(alias.status).toBe(200);
    await expect(alias.json()).resolves.toMatchObject({ id: account.profile.id, name: account.profile.name });

    const missing = await SELF.fetch(`https://worker.test/api/public/profiles/name/Missing${suffix}`);
    expect(missing.status).toBe(204);
  });
});
