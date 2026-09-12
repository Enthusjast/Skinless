import {
  SELF,
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { registerVerifiedAccount } from './verified-registration-fixture';

const PASSWORD = 'correct-password';
const SKIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAJ0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAIDODUBAAAENBzWNAAAAAElFTkSuQmCC';

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function pngFile(bytes: Uint8Array): File {
  return new File([bytes.buffer as ArrayBuffer], 'skin.png', { type: 'image/png' });
}

function jsonRequest(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authenticatedRequest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return SELF.fetch(`https://worker.test${path}`, { ...init, headers });
}

describe('deferred texture cleanup on Cloudflare runtime', () => {
  it('queues detached content, cancels on re-reference, and deletes at Cron time', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
    const email = `cleanup-${suffix}@example.com`;
    const name = `Cleanup${suffix}`;
    const registered = { user: await registerVerifiedAccount(email, PASSWORD, name) };

    const authenticate = await jsonRequest('/authserver/authenticate', {
      username: email,
      password: PASSWORD,
      clientToken: `cleanup-client-${suffix}`,
    });
    expect(authenticate.status).toBe(200);
    const token = (await authenticate.json() as { accessToken: string }).accessToken;
    const form = new FormData();
    form.set('file', pngFile(decodeBase64(SKIN_PNG_BASE64)));

    const upload = await authenticatedRequest('/api/user/skin', token, { method: 'POST', body: form });
    expect(upload.status).toBe(201);
    const uploaded = await upload.json() as { hash: string; texture: { id: string } };
    const objectKey = `${uploaded.hash}.png`;

    const removeProfileReference = await authenticatedRequest('/api/user/skin', token, { method: 'DELETE' });
    expect(removeProfileReference.status).toBe(204);
    const stillOwned = await env.DB.prepare('SELECT id FROM texture_wardrobe WHERE id = ?')
      .bind(uploaded.texture.id)
      .first<{ id: string }>();
    expect(stillOwned).not.toBeNull();

    const removeWardrobeReference = await authenticatedRequest(`/api/user/wardrobe/${uploaded.texture.id}`, token, {
      method: 'DELETE',
    });
    expect(removeWardrobeReference.status).toBe(204);
    const queued = await env.DB.prepare(
      'SELECT hash, object_key, scheduled_at, attempts, last_error FROM texture_cleanup WHERE hash = ?',
    ).bind(uploaded.hash).first<Record<string, unknown>>();
    expect(queued).toMatchObject({
      hash: uploaded.hash,
      object_key: objectKey,
      attempts: 0,
      last_error: null,
    });
    expect(Number(queued?.scheduled_at)).toBeGreaterThan(Date.now());
    expect(await env.BUCKET.head(objectKey)).not.toBeNull();

    const reReference = await authenticatedRequest('/api/user/skin', token, { method: 'POST', body: form });
    expect(reReference.status).toBe(201);
    const cancelled = await env.DB.prepare('SELECT hash FROM texture_cleanup WHERE hash = ?')
      .bind(uploaded.hash)
      .first();
    expect(cancelled).toBeNull();

    const reReferencedTexture = await env.DB.prepare(
      'SELECT id FROM texture_wardrobe WHERE user_id = ? AND hash = ? AND texture_type = ?',
    ).bind(registered.user.id, uploaded.hash, 'skin').first<{ id: string }>();
    expect(reReferencedTexture).not.toBeNull();
    await authenticatedRequest('/api/user/skin', token, { method: 'DELETE' });
    const removeReReferencedWardrobe = await authenticatedRequest(
      `/api/user/wardrobe/${reReferencedTexture!.id}`,
      token,
      { method: 'DELETE' },
    );
    expect(removeReReferencedWardrobe.status).toBe(204);

    const dueAt = Date.now() - 1;
    await env.DB.prepare('UPDATE texture_cleanup SET scheduled_at = ? WHERE hash = ?')
      .bind(dueAt, uploaded.hash)
      .run();
    const executionContext = createExecutionContext();
    await worker.scheduled!(
      createScheduledController({ cron: '0 3 * * *', scheduledTime: Date.now() }),
      env,
      executionContext,
    );
    await waitOnExecutionContext(executionContext);

    expect(await env.BUCKET.head(objectKey)).toBeNull();
    const completed = await env.DB.prepare('SELECT hash FROM texture_cleanup WHERE hash = ?')
      .bind(uploaded.hash)
      .first();
    expect(completed).toBeNull();
  });

  it('removes a queued row when its R2 object is already missing', async () => {
    const hash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64);
    await env.DB.prepare(
      `INSERT INTO texture_cleanup (hash, object_key, scheduled_at, attempts, last_error)
       VALUES (?, ?, ?, 0, NULL)`,
    ).bind(hash, `${hash}.png`, Date.now() - 1).run();

    const executionContext = createExecutionContext();
    await worker.scheduled!(
      createScheduledController({ cron: '0 3 * * *', scheduledTime: Date.now() }),
      env,
      executionContext,
    );
    await waitOnExecutionContext(executionContext);

    expect(await env.BUCKET.head(`${hash}.png`)).toBeNull();
    expect(await env.DB.prepare('SELECT hash FROM texture_cleanup WHERE hash = ?').bind(hash).first()).toBeNull();
  });
});
