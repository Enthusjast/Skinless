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

export function createTexturesProperty(input: TexturePayloadInput): TextureProperty | null {
  if (!input.skinHash && !input.capeHash) return null;

  const textures: Record<string, unknown> = {};
  if (input.skinHash) {
    textures.SKIN = {
      url: `${input.textureBaseUrl}/textures/${input.skinHash}`,
      ...(input.skinModel === 'slim' ? { metadata: { model: 'slim' } } : {}),
    };
  }
  if (input.capeHash) {
    textures.CAPE = { url: `${input.textureBaseUrl}/textures/${input.capeHash}` };
  }

  const payload = {
    timestamp: input.timestamp ?? Date.now(),
    profileId: input.profileId,
    profileName: input.profileName,
    textures,
  };

  return { name: 'textures', value: encodeBase64Utf8(JSON.stringify(payload)) };
}
