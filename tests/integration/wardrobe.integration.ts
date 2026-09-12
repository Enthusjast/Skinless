import { applyD1Migrations, SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const SKIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAJ0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAIDODUBAAAENBzWNAAAAAElFTkSuQmCC';
const SKIN_HASH = '8d447892b6efbc450beab391a7003090694cfcd0014d20766150112cab1675a0';

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function pngFile(bytes: Uint8Array, name = 'texture.png'): File {
  return new File([bytes.buffer as ArrayBuffer], name, { type: 'image/png' });
}

async function uniqueSkinPng(): Promise<Uint8Array> {
  const raw = new Uint8Array((64 * 4 + 1) * 64);
  raw[1] = 255;
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const compressed = new Response(stream.readable).arrayBuffer();
  await writer.write(raw);
  await writer.close();
  const idat = new Uint8Array(await compressed);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
    const bytes = new Uint8Array(data.byteLength + 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, data.byteLength);
    bytes.set(typeBytes, 4);
    bytes.set(data, 8);
    let crc = 0xffffffff;
    for (const value of [...typeBytes, ...data]) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    view.setUint32(data.byteLength + 8, (crc ^ 0xffffffff) >>> 0);
    return bytes;
  };
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Uint8Array.from([0, 0, 0, 64, 0, 0, 0, 64, 8, 6, 0, 0, 0])),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array()),
  ];
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function jsonRequest(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authenticatedRequest(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return SELF.fetch(`https://worker.test${path}`, { ...init, headers });
}

async function createClient(label: string): Promise<{ token: string; profileId: string }> {
  const email = `wardrobe-${label}-${crypto.randomUUID()}@example.com`;
  const register = await jsonRequest('/api/register', {
    email,
    password: 'correct-password',
    name: `W${label.slice(0, 15)}`,
  });
  expect(register.status).toBe(201);
  const registered = await register.json() as { user: { profile: { id: string } } };
  const login = await jsonRequest('/authserver/authenticate', {
    username: email,
    password: 'correct-password',
    clientToken: `wardrobe-client-${label}`,
  });
  expect(login.status).toBe(200);
  const body = await login.json() as { accessToken: string };
  return { token: body.accessToken, profileId: registered.user.profile.id };
}

function uploadForm(
  type: 'skin' | 'cape',
  name: string,
  model?: 'classic' | 'slim',
  bytes = decodeBase64(SKIN_PNG_BASE64),
): FormData {
  const form = new FormData();
  form.set('file', pngFile(bytes));
  form.set('type', type);
  form.set('name', name);
  if (model) form.set('model', model);
  return form;
}

describe('private texture wardrobe on real D1', () => {
  it('backfills one private record per owned hash and texture type without duplicates', async () => {
    const migrationTable = `task_12_backfill_${crypto.randomUUID().replaceAll('-', '')}`;
    await env.DB.exec('DROP TABLE IF EXISTS texture_wardrobe');
    await env.DB.exec('DROP TABLE IF EXISTS ' + migrationTable);

    const userId = `wardrobe-backfill-user-${crypto.randomUUID()}`;
    const firstProfileId = crypto.randomUUID().replaceAll('-', '');
    const secondProfileId = crypto.randomUUID().replaceAll('-', '');
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, password, salt, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'user', ?, ?)`,
      ).bind(userId, `${userId}@example.com`, 'hash', 'salt', now, now),
      env.DB.prepare(
        `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(firstProfileId, userId, 'BackfillOne', 'shared-skin', 'shared-cape', 'slim', now, now),
      env.DB.prepare(
        `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(secondProfileId, userId, 'BackfillTwo', 'shared-skin', null, 'slim', now + 1, now + 1),
    ]);

    const migration = env.TEST_MIGRATIONS.filter(({ name }) => name === '0004_texture_wardrobe.sql');
    expect(migration).toHaveLength(1);
    await applyD1Migrations(env.DB, migration, migrationTable);

    const records = await env.DB.prepare(
      `SELECT user_id, hash, texture_type, model, width, height, size
       FROM texture_wardrobe WHERE user_id = ? ORDER BY texture_type`,
    ).bind(userId).all<Record<string, unknown>>();
    expect(records.results).toEqual([
      {
        user_id: userId,
        hash: 'shared-cape',
        texture_type: 'cape',
        model: null,
        width: null,
        height: null,
        size: null,
      },
      {
        user_id: userId,
        hash: 'shared-skin',
        texture_type: 'skin',
        model: 'slim',
        width: null,
        height: null,
        size: null,
      },
    ]);
  });

  it('lists pages, reuses duplicate content, enforces ownership and blocks deleting applied records', async () => {
    const owner = await createClient(`owner${crypto.randomUUID().slice(0, 6)}`);
    const other = await createClient(`other${crypto.randomUUID().slice(0, 6)}`);

    const firstUpload = await authenticatedRequest('/api/user/wardrobe', owner.token, {
      method: 'POST',
      body: uploadForm('skin', 'First skin', 'classic'),
    });
    expect(firstUpload.status).toBe(201);
    const firstBody = await firstUpload.json() as { texture: { id: string; hash: string; name: string }; quota: { used: number; limit: number } };
    expect(firstBody).toMatchObject({ texture: { hash: SKIN_HASH, name: 'First skin' }, quota: { used: 1, limit: 50 } });

    const duplicateUpload = await authenticatedRequest('/api/user/wardrobe', owner.token, {
      method: 'POST',
      body: uploadForm('skin', 'Renamed duplicate', 'classic'),
    });
    expect(duplicateUpload.status).toBe(200);
    await expect(duplicateUpload.json()).resolves.toMatchObject({
      texture: { id: firstBody.texture.id, name: 'First skin' },
      quota: { used: 1, limit: 50 },
      reused: true,
    });

    const page = await authenticatedRequest('/api/user/wardrobe?limit=1&offset=0&type=skin', owner.token);
    expect(page.status).toBe(200);
    await expect(page.json()).resolves.toMatchObject({
      textures: [{ id: firstBody.texture.id, type: 'skin' }],
      total: 1,
      limit: 1,
      offset: 0,
      hasMore: false,
    });

    const foreignDelete = await authenticatedRequest(`/api/user/wardrobe/${firstBody.texture.id}`, other.token, { method: 'DELETE' });
    expect(foreignDelete.status).toBe(404);
    await expect(foreignDelete.json()).resolves.toMatchObject({ errorCode: 'texture_not_found' });

    const apply = await authenticatedRequest(`/api/user/wardrobe/${firstBody.texture.id}/apply`, owner.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: owner.profileId }),
    });
    expect(apply.status).toBe(200);
    await expect(apply.json()).resolves.toMatchObject({ profile: { id: owner.profileId, skinHash: SKIN_HASH } });

    const blockedDelete = await authenticatedRequest(`/api/user/wardrobe/${firstBody.texture.id}`, owner.token, { method: 'DELETE' });
    expect(blockedDelete.status).toBe(409);
    await expect(blockedDelete.json()).resolves.toMatchObject({
      errorCode: 'texture_in_use',
      profiles: [{ id: owner.profileId }],
    });
  });

  it('keeps legacy skin uploads reusable by creating a record and applying it to the default profile', async () => {
    const client = await createClient(`legacy${crypto.randomUUID().slice(0, 6)}`);
    const form = new FormData();
    form.set('file', pngFile(decodeBase64(SKIN_PNG_BASE64)));
    form.set('skin_model', 'slim');

    const upload = await authenticatedRequest('/api/user/skin', client.token, {
      method: 'POST',
      body: form,
    });
    expect(upload.status).toBe(201);
    const uploadBody = await upload.json() as {
      hash: string;
      profile: { id: string; skinHash: string; skinModel: string };
      texture: { type: string; model: string; width: number; height: number; size: number };
    };
    expect(uploadBody).toMatchObject({
      hash: SKIN_HASH,
      profile: { id: client.profileId, skinHash: SKIN_HASH, skinModel: 'slim' },
      texture: { type: 'skin', model: 'slim' },
    });

    const owner = await env.DB.prepare('SELECT user_id FROM profiles WHERE id = ?')
      .bind(client.profileId)
      .first<{ user_id: string }>();
    const record = await env.DB.prepare(
      `SELECT user_id, hash, texture_type, name, width, height, size
       FROM texture_wardrobe WHERE user_id = ?`,
    ).bind(owner!.user_id).first<Record<string, unknown>>();
    expect(record).toMatchObject({
      user_id: owner!.user_id,
      hash: SKIN_HASH,
      texture_type: 'skin',
      name: 'Skin',
      width: uploadBody.texture.width,
      height: uploadBody.texture.height,
      size: uploadBody.texture.size,
    });

    const duplicate = await authenticatedRequest('/api/user/skin', client.token, {
      method: 'POST',
      body: form,
    });
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ reused: true, quota: { used: 1, limit: 50 } });
  });

  it('keeps concurrent apply and delete from leaving a profile pointing at a deleted record', async () => {
    const client = await createClient(`race${crypto.randomUUID().slice(0, 6)}`);
    const upload = await authenticatedRequest('/api/user/wardrobe', client.token, {
      method: 'POST',
      body: uploadForm('skin', 'Race skin', 'classic'),
    });
    expect(upload.status).toBe(201);
    const body = await upload.json() as { texture: { id: string; hash: string } };

    const [deleteResponse, applyResponse] = await Promise.all([
      authenticatedRequest(`/api/user/wardrobe/${body.texture.id}`, client.token, { method: 'DELETE' }),
      authenticatedRequest(`/api/user/wardrobe/${body.texture.id}/apply`, client.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: client.profileId }),
      }),
    ]);
    expect([204, 409]).toContain(deleteResponse.status);
    expect([200, 404]).toContain(applyResponse.status);

    const [textureRow, profileRow] = await Promise.all([
      env.DB.prepare('SELECT id FROM texture_wardrobe WHERE id = ?').bind(body.texture.id).first(),
      env.DB.prepare('SELECT skin_hash FROM profiles WHERE id = ?').bind(client.profileId).first<{ skin_hash: string | null }>(),
    ]);
    expect(profileRow?.skin_hash === body.texture.hash).toBe(textureRow !== null);

    if (deleteResponse.status === 409) {
      await expect(deleteResponse.json()).resolves.toMatchObject({
        errorCode: 'texture_in_use',
        profiles: [{ id: client.profileId }],
      });
    }
  });

  it('rejects a new upload at fifty records but still reuses an existing hash', async () => {
    const client = await createClient(`quota${crypto.randomUUID().slice(0, 6)}`);
    const first = await authenticatedRequest('/api/user/wardrobe', client.token, {
      method: 'POST',
      body: uploadForm('skin', 'Seed', 'classic'),
    });
    const firstBody = await first.json() as { texture: { id: string } };
    const profileRow = await env.DB.prepare('SELECT user_id FROM profiles WHERE id = ?')
      .bind(client.profileId)
      .first<{ user_id: string }>();
    expect(profileRow).not.toBeNull();
    const now = Date.now();
    await env.DB.batch(Array.from({ length: 49 }, (_, index) => env.DB.prepare(
      `INSERT INTO texture_wardrobe
       (id, user_id, hash, texture_type, name, model, width, height, size, created_at, updated_at)
       VALUES (?, ?, ?, 'skin', ?, 'classic', 64, 64, 1, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      profileRow!.user_id,
      `quota-hash-${index}`,
      `Quota ${index}`,
      now + index,
      now + index,
    )));

    const rejected = await authenticatedRequest('/api/user/wardrobe', client.token, {
      method: 'POST',
      body: uploadForm('skin', 'Over quota', 'classic', await uniqueSkinPng()),
    });
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({ errorCode: 'texture_quota_reached' });

    const reused = await authenticatedRequest('/api/user/wardrobe', client.token, {
      method: 'POST',
      body: uploadForm('skin', 'Ignored name', 'classic'),
    });
    expect(reused.status).toBe(200);
    await expect(reused.json()).resolves.toMatchObject({ texture: { id: firstBody.texture.id }, reused: true });
  });

  it('applies a compatible texture to a selected owned profile and rejects model mismatches', async () => {
    const client = await createClient(`apply${crypto.randomUUID().slice(0, 6)}`);
    const createProfile = await authenticatedRequest('/api/user/profiles', client.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Slim${crypto.randomUUID().slice(0, 6)}` }),
    });
    expect(createProfile.status).toBe(201);
    const secondProfile = await createProfile.json() as { profile: { id: string } };
    await env.DB.prepare('UPDATE profiles SET skin_model = ? WHERE id = ?')
      .bind('slim', secondProfile.profile.id)
      .run();

    const upload = await authenticatedRequest('/api/user/wardrobe', client.token, {
      method: 'POST',
      body: uploadForm('skin', 'Slim skin', 'slim'),
    });
    const body = await upload.json() as { texture: { id: string } };

    const mismatch = await authenticatedRequest(`/api/user/wardrobe/${body.texture.id}/apply`, client.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: client.profileId }),
    });
    expect(mismatch.status).toBe(409);
    await expect(mismatch.json()).resolves.toMatchObject({ errorCode: 'texture_model_mismatch' });

    const applied = await authenticatedRequest(`/api/user/wardrobe/${body.texture.id}/apply`, client.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: secondProfile.profile.id }),
    });
    expect(applied.status).toBe(200);
    await expect(applied.json()).resolves.toMatchObject({ profile: { id: secondProfile.profile.id, skinHash: SKIN_HASH, skinModel: 'slim' } });
  });
});
