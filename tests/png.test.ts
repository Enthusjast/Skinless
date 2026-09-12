import { describe, expect, it } from 'vitest';
import { normalizePng } from '../src/utils/png';

const nonCanonicalModernSkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAa0lEQVR42u3QBwEAIAzAMMb1LxiGD0gdNBG1ZZ4d5dO+HQcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK/Ux1wXYi0EV47N+ssAAAAASUVORK5CYII=',
), (character) => character.charCodeAt(0));

const canonicalModernSkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAL0lEQVR4nO3BgQ0AIAgAIC3L/y+2O9qAyLUnAAAAAAAAAAAAAAAAAAAAgF/Vuf0AwXcBHE1W0YIAAAAASUVORK5CYII=',
), (character) => character.charCodeAt(0));

const legacySkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAHklEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAADwbiAgAAFXlYP5AAAAAElFTkSuQmCC',
), (character) => character.charCodeAt(0));

const patternedLegacySkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAh0lEQVR42u3TPRJDYBSF4e8TNKIUm0Ap2X+FEpsIpWj8XTOWYJjJzH1PcRfwnHOtUR57HOchsq1WLYD6BQAAAAAAAAAAAAAAAAAAAACgESB4hjL+htMYrufLMk+3YUavWPrua29dQFFW5vPO/7apumlNlia8AAAAAAAAAAAAAAAAAAAAwBXZAZXrFiFMyE+QAAAAAElFTkSuQmCC',
), (character) => character.charCodeAt(0));

const convertedLegacySkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAY0lEQVR4nO3avRlAQBAE0PObIET/3SBEPxSx353Aew3sxDObEilVdfN8nQEAAAAoaxinUB/Qdn3WPmFe1vx9xbYf2W9EnNf9dQQAAAAAAAAA/i36X1Bk/88t+l9g/wcAACjoBVMXEITIUfc3AAAAAElFTkSuQmCC',
), (character) => character.charCodeAt(0));

const wrongDimensions = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAVklEQVR4nO3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBvAI8AAT4ZY7sAAAAASUVORK5CYII=',
), (character) => character.charCodeAt(0));

function fakePngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function transparentPng(width: number, height: number): Promise<Uint8Array> {
  const raw = new Uint8Array((width * 4 + 1) * height);
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const compressed = new Response(stream.readable).arrayBuffer();
  await writer.write(raw);
  await writer.close();

  const idat = new Uint8Array(await compressed);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
    const bytes = new Uint8Array(data.byteLength + 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, data.byteLength);
    bytes.set(typeBytes, 4);
    bytes.set(data, 8);
    let crc = 0xffffffff;
    for (const value of [...typeBytes, ...data]) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    view.setUint32(data.byteLength + 8, (crc ^ 0xffffffff) >>> 0);
    return bytes;
  };
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array()),
  ];
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

describe('PNG normalization', () => {
  it('decodes real pixels and emits stable canonical PNG bytes', async () => {
    await expect(normalizePng(nonCanonicalModernSkin, 'skin')).resolves.toMatchObject({
      ok: true,
      width: 64,
      height: 64,
      sourceWidth: 64,
      sourceHeight: 64,
      legacyConverted: false,
      bytes: canonicalModernSkin,
    });
  });

  it('produces the same bytes when canonical content is normalized again', async () => {
    const normalized = await normalizePng(canonicalModernSkin, 'skin');
    expect(normalized).toMatchObject({ ok: true, bytes: canonicalModernSkin });
  });

  it('rejects a fake PNG header as corrupt content', async () => {
    await expect(normalizePng(fakePngHeader(64, 64), 'skin')).resolves.toMatchObject({
      ok: false,
      code: 'corrupt_png',
    });
  });

  it('accepts both cape resolutions without changing their stored dimensions', async () => {
    await expect(normalizePng(legacySkin, 'cape')).resolves.toMatchObject({
      ok: true,
      width: 64,
      height: 32,
      sourceWidth: 64,
      sourceHeight: 32,
    });
    await expect(normalizePng(await transparentPng(1024, 512), 'cape')).resolves.toMatchObject({
      ok: true,
      width: 1024,
      height: 512,
      sourceWidth: 1024,
      sourceHeight: 512,
    });
  });

  it('maps every legacy limb, including transparent pixel data, into the modern layout', async () => {
    await expect(normalizePng(patternedLegacySkin, 'skin')).resolves.toMatchObject({
      ok: true,
      width: 64,
      height: 64,
      sourceWidth: 64,
      sourceHeight: 32,
      legacyConverted: true,
      bytes: convertedLegacySkin,
    });
  });

  it('returns stable error codes for unsupported format and dimensions', async () => {
    await expect(normalizePng(new Uint8Array([1, 2, 3]), 'skin')).resolves.toMatchObject({
      ok: false,
      code: 'unsupported_format',
    });
    await expect(normalizePng(wrongDimensions, 'skin')).resolves.toMatchObject({
      ok: false,
      code: 'invalid_dimensions',
    });
  });
});
