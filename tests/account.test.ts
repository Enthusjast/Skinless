import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CHALLENGE_CODE_TTL_MS,
  ACCOUNT_CHALLENGE_MAX_ATTEMPTS,
  ACCOUNT_CHALLENGE_RESEND_DELAY_MS,
  generateVerificationCode,
  isSixDigitCode,
  isValidEmail,
  normalizeEmail,
} from '../src/utils/account';

describe('account challenge utilities', () => {
  it('normalizes and validates email input at the account boundary', () => {
    expect(normalizeEmail('  Player@EXAMPLE.COM ')).toBe('player@example.com');
    expect(normalizeEmail('   ')).toBeNull();
    expect(isValidEmail('player@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
  });

  it('generates exactly six numeric verification digits with fixed policy constants', () => {
    const code = generateVerificationCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(ACCOUNT_CHALLENGE_CODE_TTL_MS).toBe(10 * 60 * 1000);
    expect(ACCOUNT_CHALLENGE_RESEND_DELAY_MS).toBe(60 * 1000);
    expect(ACCOUNT_CHALLENGE_MAX_ATTEMPTS).toBe(5);
    expect(isSixDigitCode(code)).toBe(true);
  });
});
