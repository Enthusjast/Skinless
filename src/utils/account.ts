export type AccountChallengePurpose = 'password_reset' | 'email_change';

export const ACCOUNT_CHALLENGE_CODE_TTL_MS = 10 * 60 * 1000;
export const ACCOUNT_CHALLENGE_RESEND_DELAY_MS = 60 * 1000;
export const ACCOUNT_CHALLENGE_MAX_ATTEMPTS = 5;
export const PASSWORD_RESET_GENERIC_MESSAGE =
  'If an account exists for this email, a password reset code has been sent.';

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email || null;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isSixDigitCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function generateVerificationCode(): string {
  const values = new Uint32Array(1);
  const range = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return String(values[0] % range).padStart(6, '0');
}
