import type { TextureProperty } from '../types';
import { encodeBase64Utf8 } from './crypto';

export interface TexturePayloadInput {
  timestamp?: number;
  profileId: string;
  profileName: string;
  skinHash: string | null;
  capeHash: string | null;
  skinModel: 'classic' | 'slim';
  textureBaseUrl: string;
}

export interface TexturePayloadTexture {
  url: string;
  metadata?: { model: 'slim' };
}

export interface TexturePayload {
  SKIN?: TexturePayloadTexture;
  CAPE?: { url: string };
}

export function createTexturePayload(input: TexturePayloadInput): TexturePayload | null {
  if (!input.skinHash && !input.capeHash) return null;

  const textures: TexturePayload = {};
  if (input.skinHash) {
    textures.SKIN = {
      url: `${input.textureBaseUrl}/textures/${input.skinHash}`,
      ...(input.skinModel === 'slim' ? { metadata: { model: 'slim' } } : {}),
    };
  }
  if (input.capeHash) textures.CAPE = { url: `${input.textureBaseUrl}/textures/${input.capeHash}` };
  return textures;
}

export function createTexturesProperty(input: TexturePayloadInput): TextureProperty | null {
  const textures = createTexturePayload(input);
  if (!textures) return null;

  const payload = {
    timestamp: input.timestamp ?? Date.now(),
    profileId: input.profileId,
    profileName: input.profileName,
    textures,
  };

  return { name: 'textures', value: encodeBase64Utf8(JSON.stringify(payload)) };
}
