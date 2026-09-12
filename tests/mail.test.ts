import { describe, expect, it, vi } from 'vitest';
import { createResendMailSender } from '../src/utils/mail';

describe('Resend mail adapter', () => {
  it('sends a plain-text and HTML verification message through the injected fetch seam', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }),
    );
    const sender = createResendMailSender({
      apiKey: 're_test_key',
      from: 'Skinless <no-reply@example.com>',
      fetch,
    });

    await sender.sendVerificationCode('player@example.com', '042731');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer re_test_key',
          'Content-Type': 'application/json',
        },
      }),
    );
    const [, init] = fetch.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      from: 'Skinless <no-reply@example.com>',
      to: ['player@example.com'],
      subject: 'Verify your Skinless account',
      text: expect.stringContaining('042731'),
      html: expect.stringContaining('042731'),
    }));
  });

  it('fails before sending when mail configuration is incomplete', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const sender = createResendMailSender({ apiKey: '', from: '', fetch });

    await expect(sender.sendVerificationCode('player@example.com', '042731')).rejects.toMatchObject({
      code: 'mail_not_configured',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aborts a hung Resend request and logs no recipient or code', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sender = createResendMailSender({
      apiKey: 're_test_key',
      from: 'Skinless <no-reply@example.com>',
      fetch,
      timeoutMs: 25,
    });
    const pending = sender.sendVerificationCode('private@example.com', '731042');
    const rejection = expect(pending).rejects.toMatchObject({ code: 'mail_delivery_failed' });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(log).toHaveBeenCalledWith('[mail] Verification email delivery failed', { reason: 'timeout' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private@example.com');
    expect(JSON.stringify(log.mock.calls)).not.toContain('731042');
    log.mockRestore();
    vi.useRealTimers();
  });
});
