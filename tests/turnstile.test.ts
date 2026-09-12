import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstileToken } from '../src/utils/turnstile';

describe('Turnstile verification', () => {
  it('accepts a valid token from the official siteverify endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(verifyTurnstileToken('token-value', 'secret-value', {
      remoteIp: '198.51.100.20',
      fetch: fetchMock,
    })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    const body = new URLSearchParams(String(request?.body));
    expect(body.get('secret')).toBe('secret-value');
    expect(body.get('response')).toBe('token-value');
    expect(body.get('remoteip')).toBe('198.51.100.20');
  });

  it('rejects an invalid or missing token when configured', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(verifyTurnstileToken('bad-token', 'secret-value', { fetch: fetchMock })).resolves.toBe(false);
    await expect(verifyTurnstileToken(null, 'secret-value', { fetch: fetchMock })).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts requests without a token when Turnstile is not configured', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(verifyTurnstileToken(undefined, undefined, { fetch: fetchMock })).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects network failures when Turnstile is configured', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('network offline'));

    await expect(verifyTurnstileToken('token-value', 'secret-value', { fetch: fetchMock })).resolves.toBe(false);
  });
});
