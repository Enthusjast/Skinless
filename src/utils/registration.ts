export type RegistrationMode = 'open' | 'invite' | 'closed';

export interface RegistrationSettingsValues {
  registrationMode: RegistrationMode;
  maxProfilesPerUser: number;
  maxTexturesPerUser: number;
  enforceJoinIp: boolean;
}

export const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettingsValues = {
  registrationMode: 'open',
  maxProfilesPerUser: 5,
  maxTexturesPerUser: 50,
  enforceJoinIp: false,
};

interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

interface ValidationFailure {
  ok: false;
  code: string;
  message: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export interface InviteValues {
  useLimit: number;
  expiresAt: number | null;
  note: string;
}

function invalid(code: string, message: string): ValidationFailure {
  return { ok: false, code, message };
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

export function parseRegistrationSettings(
  input: Record<string, unknown> | null | undefined,
  current: RegistrationSettingsValues,
): ValidationResult<RegistrationSettingsValues> {
  if (!input) return invalid('invalid_settings', 'A JSON settings object is required.');

  const registrationMode = input.registrationMode === undefined
    ? current.registrationMode
    : input.registrationMode;
  if (registrationMode !== 'open' && registrationMode !== 'invite' && registrationMode !== 'closed') {
    return invalid('invalid_registration_mode', 'registrationMode must be open, invite or closed.');
  }

  const maxProfilesPerUser = input.maxProfilesPerUser === undefined
    ? current.maxProfilesPerUser
    : input.maxProfilesPerUser;
  if (!boundedInteger(maxProfilesPerUser, 1, 50)) {
    return invalid('invalid_profile_quota', 'maxProfilesPerUser must be an integer from 1 to 50.');
  }

  const maxTexturesPerUser = input.maxTexturesPerUser === undefined
    ? current.maxTexturesPerUser
    : input.maxTexturesPerUser;
  if (!boundedInteger(maxTexturesPerUser, 1, 500)) {
    return invalid('invalid_texture_quota', 'maxTexturesPerUser must be an integer from 1 to 500.');
  }

  const enforceJoinIp = input.enforceJoinIp === undefined ? current.enforceJoinIp : input.enforceJoinIp;
  if (typeof enforceJoinIp !== 'boolean') {
    return invalid('invalid_join_ip', 'enforceJoinIp must be a boolean.');
  }

  return {
    ok: true,
    value: {
      registrationMode,
      maxProfilesPerUser,
      maxTexturesPerUser,
      enforceJoinIp,
    },
  };
}

export function parseFutureTimestamp(value: unknown, now: number): ValidationResult<number | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };

  const timestamp = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Date.parse(value)
      : Number.NaN;
  if (!Number.isSafeInteger(timestamp) || timestamp <= now) {
    return invalid('invalid_invite_expiry', 'expiresAt must be a future timestamp.');
  }
  return { ok: true, value: timestamp };
}

export function parseInviteInput(
  input: Record<string, unknown> | null | undefined,
  now: number,
): ValidationResult<InviteValues> {
  if (!input) return invalid('invalid_invite', 'A JSON invite object is required.');

  const rawUseLimit = input.useLimit ?? input.uses ?? 1;
  if (!boundedInteger(rawUseLimit, 1, 1_000)) {
    return invalid('invalid_invite_use_limit', 'useLimit must be an integer from 1 to 1000.');
  }

  const expiry = parseFutureTimestamp(input.expiresAt, now);
  if (!expiry.ok) return expiry;

  const note = input.note === undefined || input.note === null ? '' : input.note;
  if (typeof note !== 'string') return invalid('invalid_invite_note', 'note must be a string.');

  return {
    ok: true,
    value: {
      useLimit: rawUseLimit,
      expiresAt: expiry.value,
      note: note.trim(),
    },
  };
}
