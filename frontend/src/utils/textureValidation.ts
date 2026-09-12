import { normalizePng } from '../../../src/utils/png';

export type TextureAsset = 'skin' | 'cape';
export type TextureValidationCode =
  'unsupported_format' | 'invalid_dimensions' | 'corrupt_png' | 'asset_too_large';

export const TEXTURE_FORMAT_INSTRUCTION = '请选择 PNG 文件；JPG 和 WebP 不受支持。';
export const TEXTURE_DIMENSION_INSTRUCTIONS = {
  skin: '请上传 64 × 64 PNG，或 64 × 32 旧版皮肤 PNG；不会拉伸图片。',
  cape: '请上传 64 × 32 或 1024 × 512 PNG；不会拉伸图片。',
} as const;
export const TEXTURE_CORRUPT_INSTRUCTION = 'PNG 文件损坏或无法读取；请修复后再试。';
export const TEXTURE_SIZE_INSTRUCTION = 'PNG 文件过大；请使用 64 KB 以下的纹理。';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type TextureValidation =
  | { ok: true; width: number; height: number }
  | { ok: false; code: TextureValidationCode; message: string };

export type TextureNormalization =
  | {
      ok: true;
      file: File;
      width: number;
      height: number;
      sourceWidth: number;
      sourceHeight: number;
      legacyConverted: boolean;
    }
  | { ok: false; code: TextureValidationCode; message: string };

function supportsDimensions(asset: TextureAsset, width: number, height: number): boolean {
  return asset === 'skin'
    ? width === 64 && (height === 64 || height === 32)
    : (width === 64 && height === 32) || (width === 1024 && height === 512);
}

function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const release = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      release();
      if (!width || !height) reject(new Error(TEXTURE_CORRUPT_INSTRUCTION));
      else resolve({ width, height });
    };
    image.onerror = () => {
      release();
      reject(new Error(TEXTURE_CORRUPT_INSTRUCTION));
    };
    image.src = objectUrl;
  });
}

async function hasPngSignature(file: File): Promise<boolean> {
  try {
    const header = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file.slice(0, PNG_SIGNATURE.length));
    });
    return PNG_SIGNATURE.every((value, index) => header[index] === value);
  } catch {
    return false;
  }
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error(TEXTURE_CORRUPT_INSTRUCTION));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export async function validateTextureFile(
  file: File,
  asset: TextureAsset,
): Promise<TextureValidation> {
  if (file.type !== 'image/png') {
    return { ok: false, code: 'unsupported_format', message: TEXTURE_FORMAT_INSTRUCTION };
  }

  if (!(await hasPngSignature(file))) {
    return { ok: false, code: 'corrupt_png', message: TEXTURE_CORRUPT_INSTRUCTION };
  }

  let dimensions: { width: number; height: number };
  try {
    dimensions = await loadImageDimensions(file);
  } catch {
    return { ok: false, code: 'corrupt_png', message: TEXTURE_CORRUPT_INSTRUCTION };
  }

  if (!supportsDimensions(asset, dimensions.width, dimensions.height)) {
    return {
      ok: false,
      code: 'invalid_dimensions',
      message: TEXTURE_DIMENSION_INSTRUCTIONS[asset],
    };
  }
  return { ok: true, ...dimensions };
}

function normalizationMessage(asset: TextureAsset, code: TextureValidationCode): string {
  if (code === 'unsupported_format') return TEXTURE_FORMAT_INSTRUCTION;
  if (code === 'invalid_dimensions') return TEXTURE_DIMENSION_INSTRUCTIONS[asset];
  if (code === 'asset_too_large') return TEXTURE_SIZE_INSTRUCTION;
  return TEXTURE_CORRUPT_INSTRUCTION;
}

export async function normalizeTextureFile(
  file: File,
  asset: TextureAsset,
): Promise<TextureNormalization> {
  const validation = await validateTextureFile(file, asset);
  if (!validation.ok) return validation;

  let input: ArrayBuffer;
  try {
    input = await readFileBytes(file);
  } catch {
    return { ok: false, code: 'corrupt_png', message: TEXTURE_CORRUPT_INSTRUCTION };
  }

  try {
    const normalized = await normalizePng(input, asset);
    if (!normalized.ok) {
      return {
        ok: false,
        code: normalized.code,
        message: normalizationMessage(asset, normalized.code),
      };
    }

    const normalizedFile = new File([new Uint8Array(normalized.bytes).buffer], file.name, {
      type: 'image/png',
    });
    return {
      ok: true,
      file: normalizedFile,
      width: normalized.width,
      height: normalized.height,
      sourceWidth: normalized.sourceWidth,
      sourceHeight: normalized.sourceHeight,
      legacyConverted: normalized.legacyConverted,
    };
  } catch {
    return { ok: false, code: 'corrupt_png', message: TEXTURE_CORRUPT_INSTRUCTION };
  }
}
