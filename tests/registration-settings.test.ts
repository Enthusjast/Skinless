import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGISTRATION_SETTINGS,
  parseFutureTimestamp,
  parseInviteInput,
  parseRegistrationSettings,
  type RegistrationSettingsValues,
} from '../src/utils/registration';
import { allowUnsignedTextures } from '../src/utils/config';
import type { Bindings } from '../src/types';

const current: RegistrationSettingsValues = { ...DEFAULT_REGISTRATION_SETTINGS };

describe('registration settings validation', () => {
  it('accepts the supported settings and keeps the stored shape stable', () => {
    expect(parseRegistrationSettings({
      registrationMode: 'invite',
      maxProfilesPerUser: 50,
      maxTexturesPerUser: 500,
      enforceJoinIp: true,
    }, current)).toEqual({
      ok: true,
      value: {
        registrationMode: 'invite',
        maxProfilesPerUser: 50,
        maxTexturesPerUser: 500,
        enforceJoinIp: true,
      },
    });
  });

  it('rejects unsupported modes and quota values at their configured bounds', () => {
    expect(parseRegistrationSettings({ registrationMode: 'invite-only' }, current)).toMatchObject({
      ok: false,
      code: 'invalid_registration_mode',
    });
    expect(parseRegistrationSettings({ maxProfilesPerUser: 0 }, current)).toMatchObject({
      ok: false,
      code: 'invalid_profile_quota',
    });
    expect(parseRegistrationSettings({ maxProfilesPerUser: 51 }, current)).toMatchObject({
      ok: false,
      code: 'invalid_profile_quota',
    });
    expect(parseRegistrationSettings({ maxTexturesPerUser: 0 }, current)).toMatchObject({
      ok: false,
      code: 'invalid_texture_quota',
    });
    expect(parseRegistrationSettings({ maxTexturesPerUser: 501 }, current)).toMatchObject({
      ok: false,
      code: 'invalid_texture_quota',
    });
  });

  it('requires the IP binding setting to be an explicit boolean', () => {
    expect(parseRegistrationSettings({ enforceJoinIp: 1 }, current)).toMatchObject({
      ok: false,
      code: 'invalid_join_ip',
    });
  });
});

describe('Yggdrasil signing configuration', () => {
  it('allows unsigned textures only with an explicit local-development flag', () => {
    expect(allowUnsignedTextures({
      ENVIRONMENT: 'development',
      YGGDRASIL_ALLOW_UNSIGNED_TEXTURES: 'true',
    } as unknown as Bindings)).toBe(true);
    expect(allowUnsignedTextures({
      ENVIRONMENT: 'production',
      YGGDRASIL_ALLOW_UNSIGNED_TEXTURES: 'true',
    } as unknown as Bindings)).toBe(false);
    expect(allowUnsignedTextures({ ENVIRONMENT: 'development' } as unknown as Bindings)).toBe(false);
  });
});

describe('registration invite validation', () => {
  it('defaults to one use and accepts an unexpired timestamp', () => {
    expect(parseInviteInput({ expiresAt: 2_000, note: 'Launch group' }, 1_000)).toEqual({
      ok: true,
      value: { useLimit: 1, expiresAt: 2_000, note: 'Launch group' },
    });
  });

  it('enforces the invite use limit and future expiry bounds', () => {
    expect(parseInviteInput({ useLimit: 0 }, 1_000)).toMatchObject({
      ok: false,
      code: 'invalid_invite_use_limit',
    });
    expect(parseInviteInput({ useLimit: 1_001 }, 1_000)).toMatchObject({
      ok: false,
      code: 'invalid_invite_use_limit',
    });
    expect(parseInviteInput({ expiresAt: 1_000 }, 1_000)).toMatchObject({
      ok: false,
      code: 'invalid_invite_expiry',
    });
  });

  it('allows an invite without an expiry and rejects invalid expiry values', () => {
    expect(parseFutureTimestamp(null, 1_000)).toEqual({ ok: true, value: null });
    expect(parseFutureTimestamp('not-a-date', 1_000)).toMatchObject({
      ok: false,
      code: 'invalid_invite_expiry',
    });
  });
});
