import { describe, expect, it } from 'vitest';
import { validatePng } from '../src/utils/png';

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe('PNG validation', () => {
  it('accepts a 64x64 skin header', () => {
    expect(validatePng(pngHeader(64, 64), 'skin')).toMatchObject({ ok: true, width: 64, height: 64 });
  });

  it('accepts supported cape dimensions and rejects other sizes', () => {
    expect(validatePng(pngHeader(64, 32), 'cape').ok).toBe(true);
    expect(validatePng(pngHeader(1024, 512), 'cape').ok).toBe(true);
    expect(validatePng(pngHeader(128, 128), 'cape').ok).toBe(false);
  });

  it('rejects non-PNG content', () => {
    expect(validatePng(new Uint8Array([1, 2, 3, 4]), 'skin')).toMatchObject({ ok: false });
  });
});
