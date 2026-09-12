import type { ProfileRecord, SkinModel } from '../types';

export const MAX_TEXTURES_PER_USER = 50;
export const DEFAULT_WARDROBE_PAGE_SIZE = 20;
export const MAX_WARDROBE_PAGE_SIZE = 100;
export const MAX_TEXTURE_NAME_LENGTH = 64;

export type TextureType = 'skin' | 'cape';

export interface TextureWardrobeRecord {
  id: string;
  user_id: string;
  hash: string;
  texture_type: TextureType;
  name: string;
  model: SkinModel | null;
  width: number | null;
  height: number | null;
  size: number | null;
  created_at: number;
  updated_at: number;
}

export interface WardrobePage {
  limit: number;
  offset: number;
}

export interface TextureCompatibilityInput {
  texture_type: TextureType;
  model: SkinModel | null;
}

export function parseTextureType(value: unknown): TextureType | null {
  return value === 'skin' || value === 'cape' ? value : null;
}

export function textureName(value: unknown, type: TextureType): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return type === 'skin' ? 'Skin' : 'Cape';
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TEXTURE_NAME_LENGTH || /[\r\n]/.test(normalized)) return null;
  return normalized;
}

export function parseWardrobePage(query: { limit?: string; offset?: string }): WardrobePage {
  const rawLimit = query.limit === undefined ? null : Number(query.limit);
  const rawOffset = Number(query.offset ?? '');
  const limit = rawLimit === null
    ? DEFAULT_WARDROBE_PAGE_SIZE
    : Number.isInteger(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_WARDROBE_PAGE_SIZE)
      : DEFAULT_WARDROBE_PAGE_SIZE;
  const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
  return { limit, offset };
}

export function isTextureModelCompatible(
  texture: TextureCompatibilityInput,
  profile: ProfileRecord | SkinModel,
): boolean {
  if (texture.texture_type === 'cape') return true;
  const profileModel = typeof profile === 'string' ? profile : profile.skin_model;
  return texture.model === profileModel;
}
