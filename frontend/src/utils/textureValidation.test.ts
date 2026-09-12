import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeTextureFile,
  TEXTURE_CORRUPT_INSTRUCTION,
  TEXTURE_DIMENSION_INSTRUCTIONS,
  TEXTURE_FORMAT_INSTRUCTION,
  validateTextureFile,
} from './textureValidation';

const normalizePngMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/utils/png', () => ({ normalizePng: normalizePngMock }));

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  normalizePngMock.mockReset();
});

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngFile(name: string): File {
  return new File([PNG_SIGNATURE], name, { type: 'image/png' });
}

function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function mockImage(width: number, height: number, failed = false): void {
  class FakeImage {
    naturalWidth = width;
    naturalHeight = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => (failed ? this.onerror?.() : this.onload?.()));
    }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:texture'),
    revokeObjectURL: vi.fn(),
  });
}

describe('texture file validation', () => {
  it('accepts only the supported skin dimensions', async () => {
    mockImage(64, 32);
    const result = await validateTextureFile(pngFile('skin.png'), 'skin');

    expect(result).toMatchObject({ ok: true, width: 64, height: 32 });
  });

  it('rejects non-PNG files with the format repair instruction', async () => {
    const result = await validateTextureFile(
      new File(['jpg'], 'skin.jpg', { type: 'image/jpeg' }),
      'skin',
    );

    expect(result).toEqual({
      ok: false,
      code: 'unsupported_format',
      message: TEXTURE_FORMAT_INSTRUCTION,
    });
  });

  it('rejects unsupported dimensions with the exact asset instruction', async () => {
    mockImage(128, 128);
    const result = await validateTextureFile(pngFile('cape.png'), 'cape');

    expect(result).toEqual({
      ok: false,
      code: 'invalid_dimensions',
      message: TEXTURE_DIMENSION_INSTRUCTIONS.cape,
    });
  });

  it('rejects an image that cannot be decoded before upload', async () => {
    mockImage(0, 0, true);
    const result = await validateTextureFile(pngFile('skin.png'), 'skin');

    expect(result).toMatchObject({ ok: false, code: 'corrupt_png' });
    if (!result.ok) expect(result.message).toContain('PNG');
  });

  it('rejects a spoofed PNG MIME type when the file signature is not PNG', async () => {
    const result = await validateTextureFile(
      new File(['not-a-png'], 'spoofed.png', { type: 'image/png' }),
      'skin',
    );

    expect(result).toMatchObject({ ok: false, code: 'corrupt_png' });
  });

  it('returns the normalized PNG file used by upload and preview', async () => {
    mockImage(64, 32);
    normalizePngMock.mockResolvedValue({
      ok: true,
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      width: 64,
      height: 64,
      sourceWidth: 64,
      sourceHeight: 32,
      legacyConverted: true,
    });

    const result = await normalizeTextureFile(pngFile('legacy.png'), 'skin');

    expect(result).toMatchObject({
      ok: true,
      width: 64,
      height: 64,
      sourceWidth: 64,
      sourceHeight: 32,
      legacyConverted: true,
    });
    if (result.ok) {
      expect(result.file).toBeInstanceOf(File);
      expect(result.file.type).toBe('image/png');
      expect(await readFileBytes(result.file)).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    }
    expect(normalizePngMock).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'skin');
  });

  it('maps normalization failures to exact repair guidance', async () => {
    mockImage(64, 64);
    normalizePngMock.mockResolvedValue({
      ok: false,
      code: 'corrupt_png',
      reason: 'The uploaded PNG is corrupt or incomplete.',
    });

    const result = await normalizeTextureFile(pngFile('broken.png'), 'skin');

    expect(result).toEqual({
      ok: false,
      code: 'corrupt_png',
      message: TEXTURE_CORRUPT_INSTRUCTION,
    });
  });
});
