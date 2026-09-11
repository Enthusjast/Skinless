const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const MAX_ASSET_BYTES = 64 * 1024;

export type AssetKind = 'skin' | 'cape';

export type PngValidation =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: string };

function asBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof ArrayBuffer ? new Uint8Array(input) : input;
}

export function validatePng(input: ArrayBuffer | Uint8Array, kind: AssetKind): PngValidation {
  const bytes = asBytes(input);
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    return { ok: false, reason: 'The PNG file must be 64 KB or smaller.' };
  }
  if (bytes.byteLength < 33 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    return { ok: false, reason: 'The uploaded file is not a valid PNG.' };
  }
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
    return { ok: false, reason: 'The PNG header is missing.' };
  }

  const view = new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const validDimensions = kind === 'skin'
    ? width === 64 && height === 64
    : (width === 64 && height === 32) || (width === 1024 && height === 512);

  if (!validDimensions) {
    const expected = kind === 'skin' ? '64×64' : '64×32 或 1024×512';
    return { ok: false, reason: `The ${kind} must be ${expected}.` };
  }

  return { ok: true, width, height };
}
