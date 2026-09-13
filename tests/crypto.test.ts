import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  sha256Hex,
  signHmac,
  signRsaSha256,
  verifyHmac,
  verifyPassword,
} from '../src/utils/crypto';
import { generateProfileId } from '../src/utils/uuid';
import { YGGDRASIL_PRIVATE_KEY_PEM, YGGDRASIL_PUBLIC_KEY_PEM } from './fixtures/yggdrasil-keys';

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

  it('signs the exact texture property value with the configured RSA key', async () => {
    const value = 'eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHBzOi8vc2tpbi5leGFtcGxlL3RleHR1cmVzL2hhc2gifX19';
    const signature = await signRsaSha256(value, YGGDRASIL_PRIVATE_KEY_PEM);
    const publicKeyBytes = Uint8Array.from(atob(
      YGGDRASIL_PUBLIC_KEY_PEM.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''),
    ), (character) => character.charCodeAt(0));
    const publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signatureBytes = Uint8Array.from(atob(signature), (character) => character.charCodeAt(0));

    await expect(crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signatureBytes,
      new TextEncoder().encode(value),
    )).resolves.toBe(true);
    await expect(crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signatureBytes,
      new TextEncoder().encode(value + 'tampered'),
    )).resolves.toBe(false);
  });

  it('generates a protocol-compatible profile id', () => {
    expect(generateProfileId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
