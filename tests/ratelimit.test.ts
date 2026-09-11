import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLoginFailures,
  isLoginAllowed,
  recordLoginFailure,
} from '../src/middleware/ratelimit';

describe('login rate limiter', () => {
  beforeEach(() => clearLoginFailures());

  it('blocks an IP after five failures for fifteen minutes', () => {
    const now = 1_000_000;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      recordLoginFailure('198.51.100.10', now + attempt);
    }
    expect(isLoginAllowed('198.51.100.10', now + 4)).toBe(true);

    recordLoginFailure('198.51.100.10', now + 4);
    expect(isLoginAllowed('198.51.100.10', now + 5)).toBe(false);
    expect(isLoginAllowed('198.51.100.10', now + 4 + 15 * 60 * 1000 + 1)).toBe(true);
  });

  it('clears a successful client', () => {
    recordLoginFailure('198.51.100.11', 1_000_000);
    clearLoginFailures('198.51.100.11');
    expect(isLoginAllowed('198.51.100.11', 1_000_001)).toBe(true);
  });
});
