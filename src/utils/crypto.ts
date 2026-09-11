const encoder = new TextEncoder();

export const PASSWORD_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
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
