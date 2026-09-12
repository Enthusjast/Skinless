import { describe, expect, it } from 'vitest';
import { normalizePng } from '../src/utils/png';

const nonCanonicalModernSkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAa0lEQVR42u3QBwEAIAzAMMb1LxiGD0gdNBG1ZZ4d5dO+HQcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK/Ux1wXYi0EV47N+ssAAAAASUVORK5CYII=',
), (character) => character.charCodeAt(0));

const interlacedModernSkin = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAAHdbkFIAAAHpElEQVR4nO2be1hN+RrH35kmiq7SKJK2SyU13aiQ02VC8WTSTTLRKKmnjglJOJkyKJ1malySe8hjyzQKQ4VQI1IockqXKUxMpcug41J6z7M5z+509t7ttdf+rbXNPD7/tPbv9/7e7/f37rXa+3l/BQAAWjbBaBZehs5cG/BvSMMoLQVMdgsHbnwVgqFPPNondyCIwi1L7e1kjF6D8KAohVT+9aWsMsGANH+9vivtL/V9fS2HK5Daviyrd6xDzUyodIx/2rsLreAckTu41JGMoKQzEcd67gXbxE/Q85cwDOuugI0TbXFvWDqeTlcStfYvx1BjJ9RzjhL9dovDdmMp/9q/KljyBIG1ngLqacE+1B0lTqwVGdzw0ll8otOJgWJj9OJtRE/W/vaEsl1/LUPB2E9sIyR+B9K4Wr1rjLd3S7qeT4ONAsAAleE4xGgO6M7YgEaLz6DV+mZw3K2Lc864o+/tzRDUlocrBrXhev3RkODojSkLE/DQ2nz4KeUp5p3Up3//fOADH3jvGPTpaFQbayu751rXMYh/bRZ2mn0DFssyBHbvdtqYvYrM2N0mUiy8O515I75FFmJjkp10mDOw7Gkk5V1mJW4nX5ENunkSJy2rUCJnJGVWD+21HTobpTeQEeko9W7UArvp58g/tJlYOc1+lPxrFty+eZ2UPh+350+oBz96rcLYsx5uGyg+92t9d8Z/2SRvFP0lHlTcU5jW55NV6ik4OHp9NeufhGVDS3s1rTJ0ZfZR3PGlE4LcQGVU1DQA1TEOqGm+AEfYrQKOaxIaLDiGJiGFYLm6DidveoF229Rh+sEJOPvEdJx7YRHMK1mDfve2YcDjTAjpvIpfy93HVepdsG6UJsaamGLcVBf4ziUAt82Lxl1LdsKBldl4JLYEjyc1QvY+xLPHtfFCrqWs9g5w+fJUuHrLSzbVv1L8+duf5Y2r2TdQXD6bf13TtYtd8Rv3PPq8blQ/x14Fyu8vEBhrN6hjx8DdpgCh46+msaB/749QkXNyHhxmHdS9WtnvvHLI58wZuP/ROrExw75Zwox4o+K3lOI4O+LIV6BJ/Z+UYyccP0bWQKv2NoniJ10uISf+B2ePxGvsKlvJVKBz/GFa61xaVaU38Mr8OO21HnLm0om/mXxKqvV+2h70K/CRwzmpxHksNV1Fz4C8S6HU4jyWT98p+SLFueQenXULciWrgPL8O8TEeWxaXkPdgPpXNUTFeSTFvaEWqBnykLg4j137RomvgPbyFkbEeRw+5dC/gZFrnjEmziOzWPg3pbdwYrsYFedxtn6T8AqM2yLHuDiPy51HBQ2M/2EwK+I8SgYX9x0w2aXBmjiPu5yW3gqYHxzBqjiPemvldwYmHRvDujiPJldTgMnZE2QizuNZwFwE+cHqqDBEdk0KWXHxgjUU/OKEoMrpbVJoWfnK1BQbFF6x41+XVgcBaFsLNkkMfVP+cnfE1RszBcb+1RGPMMZVdJPGZv3tP30hSu5+IXKuYUAGgkmA+CaR8yEVwraY51bdPLExzTqlANZrqDepfIpmvfd3xJ3GRZRjn1u0ITgkSd4kC24md8BDisrWpRKv6XFWQ5h9hP5eolQKaK8lRU3n17TXKiy0APA6J32TMN6ih/U7ov7NaqlzDInwRFhUTq5Jmeo9hfFCPJT/hlgunYRIhJDH5Juk3LWRxHM+Vo4jnlM/LRVg5RsGmrT/JWf/Salzt2gmkTEjBLMzeQjRGoSbxEK4ViD6j2NE0T6SRtdMQqaU1iLEjSfYpBZD1SMjsTHPxh1gxQsPpwc9AD/YEWqSS8Dvg4IENF+YHGXbBsx5qYewx4tAk54mLz87hF2TTshKHnxUHBGOhEp5SEATnHaWf63g/qtMPCweGwhwIlaKQwoayE2/KHJOK3I4q17CpmxGyN1J85BEQga6XqUca7jbmxVPkW5chMJMZj9uBnvdor3WJn8rUS//T0zQdYAbhRIeElFE1a+SWC7nBzcZ8ZjwjycIlfckOKSigMaSepLp+uAzYBBRr9u3qiDcb6d4SCaGYX9/TCQPFYKNZhDJs59rBtAiT+GQrh9GrGonYoYOUXM2SOWdm++O0DlCzCGhCEZFv5BGmyjxK/Jp7eFkRQQCmvdzSCmEMSKOFN8HUlNeSxR/vjkFQHEmtR0ZfDeQri/W4eZZUdpTEeQgaPgJOaT9HybsUCVmjG1yfl3R797KPq1GGLmyWOik6b5hTPlinWsf/yR0vNq4G8BgS0ufKlkeGcWWL9ap0m/us9ffHHURzA+8OyS3zjSQmTG2+X3Wu/+KbfOxR5j6syn87bwtOhS6oNN1b5hZHoCzqsLRtT4a3B4loEfrTvR+ng7zu7Lxy4/zcZFiCSxWq8IlwxoxWPcphI5DXGashMsttSFiij6udrDEtc72EP2FK8Z4++K3fkthc2AEbgmNxcQV30PSmj24NYaLO+J+htTvC3DPjlu4f28tHDzchOkZ/8aj2XKQkaOGmRdHYlaREZy6YY1nKpwwt2YunH+wEC82hWJBRxRcebEJr/VsxRL5A3BT6Ucs18jFiuFFUMm5g9WGDVhn2goNVq/x4bSB+MhpKDTN5uAT98+wff5UeOrvjJ1LvfDlssXwH6mX+S1bJpFUAAAAAElFTkSuQmCC',
), (character) => character.charCodeAt(0));

const canonicalInterlacedSkin = Uint8Array.from(atob(
  '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',
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

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return result;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function splitIdatWithAncillary(source: Uint8Array): Uint8Array {
  const parts = [source.subarray(0, 8)];
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  let offset = 8;
  while (offset < source.byteLength) {
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + length + 4;
    const type = String.fromCharCode(...source.subarray(typeOffset, dataOffset));
    if (type === 'IDAT') {
      const data = source.subarray(dataOffset, dataOffset + length);
      const midpoint = Math.max(1, Math.floor(data.length / 2));
      parts.push(
        makeChunk('IDAT', data.subarray(0, midpoint)),
        makeChunk('tEXt', Uint8Array.from([0x6b, 0, 0x76])),
        makeChunk('IDAT', data.subarray(midpoint)),
      );
    } else {
      parts.push(source.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }
  return concatBytes(parts);
}

function replaceChunkType(source: Uint8Array, targetType: string, replacement: Uint8Array): Uint8Array {
  const result = source.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  let offset = 8;
  while (offset + 12 <= result.byteLength) {
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const type = String.fromCharCode(...result.subarray(typeOffset, dataOffset));
    if (type === targetType) {
      result.set(replacement, typeOffset);
      return result;
    }
    offset = dataOffset + length + 4;
  }
  throw new Error(`Missing ${targetType} chunk`);
}

function mutateChunk(
  source: Uint8Array,
  targetType: string,
  mutate: (data: Uint8Array) => void,
  updateCrc = true,
): Uint8Array {
  const result = source.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  let offset = 8;
  while (offset + 12 <= result.byteLength) {
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const type = String.fromCharCode(...result.subarray(typeOffset, dataOffset));
    if (type === targetType) {
      const data = result.subarray(dataOffset, crcOffset);
      mutate(data);
      if (updateCrc) {
        const crcInput = new Uint8Array(4 + data.length);
        crcInput.set(result.subarray(typeOffset, dataOffset));
        crcInput.set(data, 4);
        view.setUint32(crcOffset, crc32(crcInput));
      }
      return result;
    }
    offset = crcOffset + 4;
  }
  throw new Error(`Missing ${targetType} chunk`);
}

describe('PNG normalization', () => {
  it('decodes Adam7 interlaced pixels into the same canonical RGBA output', async () => {
    await expect(normalizePng(interlacedModernSkin, 'skin')).resolves.toMatchObject({
      ok: true,
      width: 64,
      height: 64,
      sourceWidth: 64,
      sourceHeight: 64,
      legacyConverted: false,
      bytes: canonicalInterlacedSkin,
    });
  });

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

  it('rejects invalid chunk type bytes and non-consecutive IDAT chunks', async () => {
    const invalidReservedBit = replaceChunkType(
      interlacedModernSkin,
      'IDAT',
      Uint8Array.from([0x49, 0x44, 0x61, 0x54]),
    );
    await expect(normalizePng(invalidReservedBit, 'skin')).resolves.toMatchObject({
      ok: false,
      code: 'corrupt_png',
    });

    const separatedIdat = splitIdatWithAncillary(interlacedModernSkin);
    await expect(normalizePng(separatedIdat, 'skin')).resolves.toMatchObject({
      ok: false,
      code: 'corrupt_png',
    });
  });

  it('rejects corrupt CRC and deflate data with corrupt_png', async () => {
    const invalidCrc = interlacedModernSkin.slice();
    invalidCrc[invalidCrc.length - 1] = (invalidCrc[invalidCrc.length - 1] ?? 0) ^ 0xff;
    await expect(normalizePng(invalidCrc, 'skin')).resolves.toMatchObject({
      ok: false,
      code: 'corrupt_png',
    });

    const invalidDeflate = mutateChunk(interlacedModernSkin, 'IDAT', (data) => {
      data[Math.floor(data.length / 2)] = (data[Math.floor(data.length / 2)] ?? 0) ^ 0xff;
    });
    await expect(normalizePng(invalidDeflate, 'skin')).resolves.toMatchObject({
      ok: false,
      code: 'corrupt_png',
    });
  });
});
