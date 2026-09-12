import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TEXTURE_DIMENSION_INSTRUCTIONS,
  TEXTURE_FORMAT_INSTRUCTION,
  validateTextureFile,
} from './textureValidation';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngFile(name: string): File {
  return new File([PNG_SIGNATURE], name, { type: 'image/png' });
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
});
