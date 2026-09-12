import { describe, expect, it } from 'vitest';
import { hashPassword, sha256Hex, signHmac, verifyHmac, verifyPassword } from '../src/utils/crypto';
import { generateProfileId } from '../src/utils/uuid';

describe('crypto utilities', () => {
  it('hashes and verifies a password without storing the plaintext', async () => {
    const salt = 'test-salt';
    const hash = await hashPassword('correct horse battery staple', salt);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('correct');
    await expect(verifyPassword('correct horse battery staple', salt, hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', salt, hash)).resolves.toBe(false);
  });

  it('returns the known SHA-256 digest for content', async () => {
    await expect(sha256Hex(new TextEncoder().encode('Skinless'))).resolves.toBe(
      '0c91bf66dc48dfa9738985a4224bb72bd02077669fc79885b3637779277eac87',
    );
  });

  it('signs and verifies values with Web Crypto HMAC', async () => {
    const signature = await signHmac('session-payload', 'session-secret');

    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    await expect(verifyHmac('session-payload', signature, 'session-secret')).resolves.toBe(true);
    await expect(verifyHmac('tampered-payload', signature, 'session-secret')).resolves.toBe(false);
    await expect(verifyHmac('session-payload', signature, 'wrong-secret')).resolves.toBe(false);
  });

  it('generates a protocol-compatible profile id', () => {
    expect(generateProfileId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
