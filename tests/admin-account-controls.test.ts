import { describe, expect, it } from 'vitest';
import { parseAdminUserStatus } from '../src/utils/admin';

describe('administrator account status validation', () => {
  it('accepts only the supported account statuses', () => {
    expect(parseAdminUserStatus('active')).toEqual({ ok: true, value: 'active' });
    expect(parseAdminUserStatus('disabled')).toEqual({ ok: true, value: 'disabled' });
    expect(parseAdminUserStatus('pending_deletion')).toEqual({
      ok: true,
      value: 'pending_deletion',
    });
    expect(parseAdminUserStatus('suspended')).toMatchObject({
      ok: false,
      code: 'invalid_status',
    });
  });
});
