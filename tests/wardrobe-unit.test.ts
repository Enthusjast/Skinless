import { describe, expect, it } from 'vitest';
import {
  MAX_TEXTURES_PER_USER,
  isTextureModelCompatible,
  parseTextureType,
  parseWardrobePage,
  textureName,
} from '../src/utils/wardrobe';

describe('private texture wardrobe rules', () => {
  it('accepts only the two protocol texture types', () => {
    expect(parseTextureType('skin')).toBe('skin');
    expect(parseTextureType('cape')).toBe('cape');
    expect(parseTextureType('library')).toBeNull();
    expect(parseTextureType(undefined)).toBeNull();
  });

  it('keeps names bounded and supplies stable defaults for legacy uploads', () => {
    expect(textureName('  My skin  ', 'skin')).toBe('My skin');
    expect(textureName('', 'skin')).toBe('Skin');
    expect(textureName('x'.repeat(65), 'skin')).toBeNull();
    expect(textureName('line\nbreak', 'skin')).toBeNull();
  });

  it('clamps pagination without allowing negative offsets or oversized pages', () => {
    expect(parseWardrobePage({})).toEqual({ limit: 20, offset: 0 });
    expect(parseWardrobePage({ limit: '2', offset: '4' })).toEqual({ limit: 2, offset: 4 });
    expect(parseWardrobePage({ limit: '0', offset: '0' })).toEqual({ limit: 1, offset: 0 });
    expect(parseWardrobePage({ limit: '999', offset: '-4' })).toEqual({ limit: 100, offset: 0 });
    expect(parseWardrobePage({ limit: 'bad', offset: 'bad' })).toEqual({ limit: 20, offset: 0 });
  });

  it('uses the fixed account quota and enforces skin model compatibility only for skins', () => {
    expect(MAX_TEXTURES_PER_USER).toBe(50);
    expect(isTextureModelCompatible({ texture_type: 'skin', model: 'slim' }, 'slim')).toBe(true);
    expect(isTextureModelCompatible({ texture_type: 'skin', model: 'slim' }, 'classic')).toBe(false);
    expect(isTextureModelCompatible({ texture_type: 'cape', model: null }, 'classic')).toBe(true);
  });
});
