const encoder = new TextEncoder();

export const PASSWORD_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function pemToBytes(pem: string): Uint8Array {
  const encoded = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('Invalid PEM key.');
  }
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

export async function hashPassword(
  password: string,
  salt: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

export function timingSafeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<boolean> {
  const actualHash = await hashPassword(password, salt, iterations);
  return timingSafeEqual(actualHash, expectedHash);
}

export async function sha256Hex(input: ArrayBuffer | ArrayBufferView): Promise<string> {
  const data = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer as ArrayBuffer, input.byteOffset, input.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export async function signRsaSha256(value: string, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(privateKeyPem) as unknown as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(value),
  );
  return bytesToBase64(new Uint8Array(signature));
}

export function createSalt(): string {
  return crypto.randomUUID();
}

export function createAccessToken(): string {
  return crypto.randomUUID();
}

export function encodeBase64Utf8(value: string): string {
  const bytes = encoder.encode(value);
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function signHmac(value: string, secret: string): Promise<string> {
  const key = await hmacKey(secret, 'sign');
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return encodeBase64Url(new Uint8Array(signature));
}

export async function verifyHmac(value: string, signature: string, secret: string): Promise<boolean> {
  const decoded = decodeBase64Url(signature);
  if (!decoded) return false;

  try {
    const key = await hmacKey(secret, 'verify');
    return await crypto.subtle.verify('HMAC', key, decoded as unknown as BufferSource, encoder.encode(value));
  } catch {
    return false;
  }
}
