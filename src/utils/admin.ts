import type { UserStatus } from '../types';

export const ADMIN_ACCOUNT_STATUSES: readonly UserStatus[] = [
  'active',
  'disabled',
  'pending_deletion',
];

export const ADMIN_DISABLE_CONFIRMATION = 'DISABLE';
export const ADMIN_DEMOTION_CONFIRMATION = 'DEMOTE';
export const ADMIN_SESSION_REVOKE_CONFIRMATION = 'REVOKE';
export const ADMIN_USER_DELETE_CONFIRMATION = 'DELETE';

export type AdminStatusValidation =
  | { ok: true; value: UserStatus }
  | { ok: false; code: 'invalid_status'; message: string };

export function parseAdminUserStatus(value: unknown): AdminStatusValidation {
  if (
    typeof value === 'string' &&
    ADMIN_ACCOUNT_STATUSES.includes(value as UserStatus)
  ) {
    return { ok: true, value: value as UserStatus };
  }
  return {
    ok: false,
    code: 'invalid_status',
    message: 'status must be active, disabled, or pending_deletion.',
  };
}
