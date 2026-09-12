const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const MAX_ASSET_BYTES = 64 * 1024;
const MAX_DECODED_BYTES = 4 * 1024 * 1024;

export type AssetKind = 'skin' | 'cape';
export type PngErrorCode =
  | 'unsupported_format'
  | 'invalid_dimensions'
  | 'corrupt_png'
  | 'asset_too_large';

export type PngFailure = {
  ok: false;
  code: PngErrorCode;
  reason: string;
};

export type PngNormalization =
  | {
      ok: true;
      bytes: Uint8Array;
      width: number;
      height: number;
      sourceWidth: number;
      sourceHeight: number;
      legacyConverted: boolean;
    }
  | PngFailure;

interface ParsedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  rowBytes: number;
  filterBytesPerPixel: number;
  idat: Uint8Array[];
  palette: Uint8Array | null;
  transparency: Uint8Array | null;
}

const UNSUPPORTED_FORMAT = 'Only PNG files are supported.';
const INVALID_DIMENSIONS = {
  skin: 'The skin must be 64×64 or 64×32 PNG.',
  cape: 'The cape must be 64×32 or 1024×512 PNG.',
} as const;
const CORRUPT_PNG = 'The uploaded PNG is corrupt or incomplete.';
const ASSET_TOO_LARGE = 'The normalized PNG must be 64 KB or smaller.';

function failure(code: PngErrorCode, reason: string): PngFailure {
  return { ok: false, code, reason };
}

function asBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer as ArrayBuffer, input.byteOffset, input.byteLength);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength).getUint16(offset);
}

function text(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

let crcTable: Uint32Array | undefined;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunkCrc(type: Uint8Array, data: Uint8Array): number {
  const bytes = new Uint8Array(type.length + data.length);
  bytes.set(type);
  bytes.set(data, type.length);
  return crc32(bytes);
}

function isSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function isSupportedDimensions(width: number, height: number, kind: AssetKind): boolean {
  return kind === 'skin'
    ? width === 64 && (height === 64 || height === 32)
    : (width === 64 && height === 32) || (width === 1024 && height === 512);
}

function colorChannels(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 3:
      return 1;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return 0;
  }
}

function isValidBitDepth(colorType: number, bitDepth: number): boolean {
  if (colorType === 0 || colorType === 3) {
    return [1, 2, 4, 8, 16].includes(bitDepth) && !(colorType === 3 && bitDepth === 16);
  }
  if (colorType === 2 || colorType === 4 || colorType === 6) return bitDepth === 8 || bitDepth === 16;
  return false;
}

function validateChunkCrc(bytes: Uint8Array, type: Uint8Array, data: Uint8Array, crcOffset: number): boolean {
  return uint32(bytes, crcOffset) === chunkCrc(type, data);
}

function parsePng(bytes: Uint8Array, kind: AssetKind): ParsedPng | PngFailure {
  if (bytes.byteLength > MAX_ASSET_BYTES) return failure('asset_too_large', 'The uploaded file must be 64 KB or smaller.');
  if (bytes.byteLength < PNG_SIGNATURE.length || !isSignature(bytes)) return failure('unsupported_format', UNSUPPORTED_FORMAT);

  let offset = PNG_SIGNATURE.length;
  let sawIhdr = false;
  let sawIdat = false;
  let endedIdat = false;
  let sawIend = false;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (offset < bytes.byteLength) {
    if (sawIend || bytes.byteLength - offset < 12) return failure('corrupt_png', CORRUPT_PNG);

    const length = uint32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const crcOffset = dataEnd;
    const chunkEnd = crcOffset + 4;
    if (length > bytes.byteLength || dataEnd < dataOffset || chunkEnd > bytes.byteLength) {
      return failure('corrupt_png', CORRUPT_PNG);
    }

    const typeBytes = bytes.subarray(typeOffset, dataOffset);
    const chunkType = text(typeBytes);
    const data = bytes.subarray(dataOffset, dataEnd);
    if (!validateChunkCrc(bytes, typeBytes, data, crcOffset)) return failure('corrupt_png', CORRUPT_PNG);

    if (chunkType === 'IHDR') {
      if (sawIhdr || length !== 13 || offset !== PNG_SIGNATURE.length) return failure('corrupt_png', CORRUPT_PNG);
      sawIhdr = true;
      width = uint32(data, 0);
      height = uint32(data, 4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      if (data[10] !== 0 || data[11] !== 0) return failure('corrupt_png', CORRUPT_PNG);
      interlace = data[12] ?? 0;
    } else if (chunkType === 'PLTE') {
      if (!sawIhdr || sawIdat || palette || length === 0 || length % 3 !== 0 || length > 768) {
        return failure('corrupt_png', CORRUPT_PNG);
      }
      palette = data;
    } else if (chunkType === 'tRNS') {
      if (!sawIhdr || sawIdat || transparency) return failure('corrupt_png', CORRUPT_PNG);
      transparency = data;
    } else if (chunkType === 'IDAT') {
      if (!sawIhdr || endedIdat || length === 0) return failure('corrupt_png', CORRUPT_PNG);
      sawIdat = true;
      idat.push(data);
    } else if (chunkType === 'IEND') {
      if (!sawIhdr || !sawIdat || length !== 0) return failure('corrupt_png', CORRUPT_PNG);
      sawIend = true;
    } else {
      if (sawIdat) endedIdat = true;
      if ((typeBytes[0] ?? 0) < 0x61) return failure('corrupt_png', CORRUPT_PNG);
    }

    if (chunkType !== 'IDAT' && sawIdat && chunkType !== 'IEND') endedIdat = true;
    offset = chunkEnd;
  }

  if (!sawIhdr || !sawIend || offset !== bytes.byteLength) return failure('corrupt_png', CORRUPT_PNG);
  if (!width || !height || !isSupportedDimensions(width, height, kind)) {
    return failure('invalid_dimensions', INVALID_DIMENSIONS[kind]);
  }
  if (interlace !== 0 || !isValidBitDepth(colorType, bitDepth)) return failure('corrupt_png', CORRUPT_PNG);

  const channels = colorChannels(colorType);
  const bitsPerPixel = channels * bitDepth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const scanlineBytes = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(scanlineBytes) || scanlineBytes > MAX_DECODED_BYTES) {
    return failure('asset_too_large', 'The decoded PNG is too large.');
  }
  if (colorType === 3 && !palette) return failure('corrupt_png', CORRUPT_PNG);
  if (palette && colorType === 3 && palette.length / 3 > (1 << bitDepth)) return failure('corrupt_png', CORRUPT_PNG);
  if (transparency) {
    const validTransparency = colorType === 0 ? transparency.length === 2
      : colorType === 2 ? transparency.length === 6
        : colorType === 3 ? transparency.length <= 256
          : false;
    if (!validTransparency) return failure('corrupt_png', CORRUPT_PNG);
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    rowBytes,
    filterBytesPerPixel,
    idat,
    palette,
    transparency,
  };
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

async function inflate(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate');
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const readPromise = (async () => {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('Decoded PNG exceeds its bounded size.');
      }
      chunks.push(result.value);
    }
  })();

  try {
    await writer.write(bytes as unknown as BufferSource);
    await writer.close();
    await readPromise;
    return joinBytes(chunks);
  } catch (error) {
    await writer.abort().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    await readPromise.catch(() => undefined);
    throw error;
  }
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const output = new Response(stream.readable).arrayBuffer();
  await writer.write(bytes as unknown as BufferSource);
  await writer.close();
  return new Uint8Array(await output);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function unfilter(inflated: Uint8Array, parsed: ParsedPng): Uint8Array | null {
  const expectedLength = (parsed.rowBytes + 1) * parsed.height;
  if (inflated.byteLength !== expectedLength) return null;

  const pixels = new Uint8Array(parsed.rowBytes * parsed.height);
  const previous = new Uint8Array(parsed.rowBytes);
  for (let y = 0; y < parsed.height; y += 1) {
    const sourceOffset = y * (parsed.rowBytes + 1);
    const filter = inflated[sourceOffset];
    if (filter === undefined || filter > 4) return null;
    const filtered = inflated.subarray(sourceOffset + 1, sourceOffset + 1 + parsed.rowBytes);
    const row = pixels.subarray(y * parsed.rowBytes, (y + 1) * parsed.rowBytes);
    for (let index = 0; index < parsed.rowBytes; index += 1) {
      const left = index >= parsed.filterBytesPerPixel ? row[index - parsed.filterBytesPerPixel] ?? 0 : 0;
      const above = previous[index] ?? 0;
      const upperLeft = index >= parsed.filterBytesPerPixel ? previous[index - parsed.filterBytesPerPixel] ?? 0 : 0;
      const value = filtered[index] ?? 0;
      row[index] = (filter === 0 ? value
        : filter === 1 ? value + left
          : filter === 2 ? value + above
            : filter === 3 ? value + Math.floor((left + above) / 2)
              : value + paeth(left, above, upperLeft)) & 0xff;
    }
    previous.set(row);
  }
  return pixels;
}

function sample(row: Uint8Array, index: number, bitDepth: number): number {
  if (bitDepth === 8) return row[index] ?? 0;
  if (bitDepth === 16) return ((row[index] ?? 0) << 8) | (row[index + 1] ?? 0);
  const samplesPerByte = 8 / bitDepth;
  const byte = row[Math.floor(index / samplesPerByte)] ?? 0;
  const shift = (samplesPerByte - 1 - (index % samplesPerByte)) * bitDepth;
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function toByte(value: number, bitDepth: number): number {
  if (bitDepth === 16) return value >> 8;
  if (bitDepth === 8) return value;
  return Math.round((value * 255) / ((1 << bitDepth) - 1));
}

function decodePixels(inflated: Uint8Array, parsed: ParsedPng): Uint8Array | null {
  const filtered = unfilter(inflated, parsed);
  if (!filtered) return null;
  const rgba = new Uint8Array(parsed.width * parsed.height * 4);
  const sampleBytes = parsed.bitDepth === 16 ? 2 : parsed.bitDepth === 8 ? 1 : 0;

  for (let y = 0; y < parsed.height; y += 1) {
    const row = filtered.subarray(y * parsed.rowBytes, (y + 1) * parsed.rowBytes);
    for (let x = 0; x < parsed.width; x += 1) {
      const outputOffset = (y * parsed.width + x) * 4;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 255;

      if (parsed.colorType === 0) {
        const graySample = sample(row, parsed.bitDepth === 16 ? x * 2 : x, parsed.bitDepth);
        red = toByte(graySample, parsed.bitDepth);
        green = red;
        blue = red;
        if (parsed.transparency && graySample === uint16(parsed.transparency, 0)) alpha = 0;
      } else if (parsed.colorType === 2) {
        const offset = x * 3 * sampleBytes;
        const redSample = sample(row, offset, parsed.bitDepth);
        const greenSample = sample(row, offset + sampleBytes, parsed.bitDepth);
        const blueSample = sample(row, offset + sampleBytes * 2, parsed.bitDepth);
        red = toByte(redSample, parsed.bitDepth);
        green = toByte(greenSample, parsed.bitDepth);
        blue = toByte(blueSample, parsed.bitDepth);
        if (parsed.transparency && redSample === uint16(parsed.transparency, 0)
          && greenSample === uint16(parsed.transparency, 2)
          && blueSample === uint16(parsed.transparency, 4)) alpha = 0;
      } else if (parsed.colorType === 3) {
        const paletteIndex = sample(row, x, parsed.bitDepth);
        const paletteOffset = paletteIndex * 3;
        if (!parsed.palette || paletteOffset + 2 >= parsed.palette.length) return null;
        red = parsed.palette[paletteOffset] ?? 0;
        green = parsed.palette[paletteOffset + 1] ?? 0;
        blue = parsed.palette[paletteOffset + 2] ?? 0;
        alpha = parsed.transparency?.[paletteIndex] ?? 255;
      } else if (parsed.colorType === 4) {
        const offset = x * 2 * sampleBytes;
        const gray = sample(row, offset, parsed.bitDepth);
        red = toByte(gray, parsed.bitDepth);
        green = red;
        blue = red;
        alpha = toByte(sample(row, offset + sampleBytes, parsed.bitDepth), parsed.bitDepth);
      } else if (parsed.colorType === 6) {
        const offset = x * 4 * sampleBytes;
        red = toByte(sample(row, offset, parsed.bitDepth), parsed.bitDepth);
        green = toByte(sample(row, offset + sampleBytes, parsed.bitDepth), parsed.bitDepth);
        blue = toByte(sample(row, offset + sampleBytes * 2, parsed.bitDepth), parsed.bitDepth);
        alpha = toByte(sample(row, offset + sampleBytes * 3, parsed.bitDepth), parsed.bitDepth);
      } else {
        return null;
      }

      rgba[outputOffset] = red;
      rgba[outputOffset + 1] = green;
      rgba[outputOffset + 2] = blue;
      rgba[outputOffset + 3] = alpha;
    }
  }
  return rgba;
}

function copyTextureRect(
  source: Uint8Array,
  target: Uint8Array,
  sourceX: number,
  sourceY: number,
  width: number,
  height: number,
  targetX: number,
  targetY: number,
): void {
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = ((sourceY + y) * 64 + sourceX) * 4;
    const targetOffset = ((targetY + y) * 64 + targetX) * 4;
    target.set(source.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
  }
}

function convertLegacySkin(pixels: Uint8Array): Uint8Array {
  const converted = new Uint8Array(64 * 64 * 4);
  converted.set(pixels);
  copyTextureRect(pixels, converted, 0, 16, 16, 16, 16, 48);
  copyTextureRect(pixels, converted, 40, 16, 16, 16, 32, 48);
  return converted;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.byteLength);
  new DataView(chunk.buffer).setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  new DataView(chunk.buffer).setUint32(8 + data.byteLength, chunkCrc(typeBytes, data));
  return chunk;
}

async function encodeCanonicalPng(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const rowBytes = width * 4;
  const scanlines = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowBytes + 1);
    scanlines.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), scanlineOffset + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const encoded = joinBytes([
    Uint8Array.from(PNG_SIGNATURE),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', await deflate(scanlines)),
    makeChunk('IEND', new Uint8Array()),
  ]);
  if (encoded.byteLength > MAX_ASSET_BYTES) throw new Error(ASSET_TOO_LARGE);
  return encoded;
}

export async function normalizePng(input: ArrayBuffer | Uint8Array, kind: AssetKind): Promise<PngNormalization> {
  const bytes = asBytes(input);
  const parsed = parsePng(bytes, kind);
  if ('code' in parsed) return parsed;

  try {
    const compressed = joinBytes(parsed.idat);
    const inflated = await inflate(compressed, (parsed.rowBytes + 1) * parsed.height);
    const pixels = decodePixels(inflated, parsed);
    if (!pixels) return failure('corrupt_png', CORRUPT_PNG);
    const legacyConverted = kind === 'skin' && parsed.height === 32;
    const outputWidth = parsed.width;
    const outputHeight = legacyConverted ? 64 : parsed.height;
    const outputPixels = legacyConverted ? convertLegacySkin(pixels) : pixels;
    const canonical = await encodeCanonicalPng(outputPixels, outputWidth, outputHeight);
    return {
      ok: true,
      bytes: canonical,
      width: outputWidth,
      height: outputHeight,
      sourceWidth: parsed.width,
      sourceHeight: parsed.height,
      legacyConverted,
    };
  } catch (error) {
    if (error instanceof Error && error.message === ASSET_TOO_LARGE) {
      return failure('asset_too_large', ASSET_TOO_LARGE);
    }
    return failure('corrupt_png', CORRUPT_PNG);
  }
}

export const validatePng = normalizePng;
