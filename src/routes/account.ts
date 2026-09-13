import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  completeEmailChange,
  completePasswordReset,
  claimAccountChallengeResend,
  deleteUserTokens,
  deleteUserServerSessions,
  findAccountChallengeById,
  findAccountChallengeByUserAndPurpose,
  findUserByEmail,
  findUserById,
  incrementAccountChallengeAttempts,
  isConstraintViolation,
  revokeOtherWebSessions,
  revokeUserWebSessions,
  restoreAccount,
  startAccountDeletion,
  updateAccountChallenge,
  upsertAccountChallenge,
} from '../db/queries';
import { authMiddleware } from '../middleware/auth';
import {
  recordAccountChallengeEmailAttempt,
  recordAccountChallengeIpAttempt,
  getClientKey,
} from '../middleware/ratelimit';
import { createSalt, hashPassword, sha256Hex, timingSafeEqual, verifyPassword } from '../utils/crypto';
import { jsonError, readJson } from '../utils/errors';
import {
  ACCOUNT_CHALLENGE_CODE_TTL_MS,
  ACCOUNT_CHALLENGE_MAX_ATTEMPTS,
  ACCOUNT_CHALLENGE_RESEND_DELAY_MS,
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_GRACE_PERIOD_MS,
  ACCOUNT_RESTORE_CODE_TTL_MS,
  ACCOUNT_RESTORE_PURPOSE,
  generateVerificationCode,
  isSixDigitCode,
  isValidEmail,
  normalizeEmail,
  PASSWORD_RESET_GENERIC_MESSAGE,
  type AccountChallengePurpose,
} from '../utils/account';
import {
  createResendMailSender,
  isMailConfigured,
  MailError,
  type MailSender,
} from '../utils/mail';
import { turnstileTokenFromBody, verifyTurnstileToken } from '../utils/turnstile';
import { serializeUser } from '../utils/serializers';
import { generateUserId } from '../utils/uuid';
import { clearWebSessionCookies } from '../utils/session';
import type { AppEnv } from '../types';
import {
  AUDIT_ACTIONS,
  recordAuditLog,
  requestIdFromRequest,
  type AuditLogEvent,
} from '../audit';

interface PasswordResetStartInput {
  email?: unknown;
  turnstileToken?: unknown;
}

interface PasswordResetInput extends PasswordResetStartInput {
  challengeId?: unknown;
  resetId?: unknown;
  code?: unknown;
  newPassword?: unknown;
  password?: unknown;
  new_password?: unknown;
}

interface EmailChangeStartInput {
  currentPassword?: unknown;
  current_password?: unknown;
  newEmail?: unknown;
  new_email?: unknown;
  email?: unknown;
  turnstileToken?: unknown;
}

interface EmailChangeInput extends EmailChangeStartInput {
  challengeId?: unknown;
  emailChangeId?: unknown;
  code?: unknown;
}

interface AccountDeletionInput {
  currentPassword?: unknown;
  current_password?: unknown;
  confirmation?: unknown;
  confirm?: unknown;
  confirmText?: unknown;
  turnstileToken?: unknown;
}

interface AccountRestoreInput {
  email?: unknown;
  challengeId?: unknown;
  code?: unknown;
  turnstileToken?: unknown;
}

const PASSWORD_RESET_PURPOSE = 'password_reset' as const;
const EMAIL_CHANGE_PURPOSE = 'email_change' as const;

const routes = new Hono<AppEnv>();

async function writeAudit(
  c: Context<AppEnv>,
  event: Omit<AuditLogEvent, 'requestId'> & { requestId?: string | null },
): Promise<void> {
  await recordAuditLog(c.env.DB, {
    ...event,
    requestId: event.requestId ?? requestIdFromRequest(c.req.raw),
  });
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asPassword(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function invalidEmail(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    400,
    'A valid email address is required.',
    'IllegalArgumentException',
    'invalid_email',
  );
}

function invalidVerification(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    400,
    'The verification code is invalid or expired.',
    'IllegalArgumentException',
    'invalid_verification_code',
  );
}

function attemptsExhausted(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    429,
    'Too many verification attempts. Request a new code.',
    'TooManyRequests',
    'verification_attempts_exhausted',
  );
}

function passwordError(c: Context<AppEnv>, code: 'password_too_short' | 'password_too_long'): Response {
  return jsonError(
    c,
    400,
    code === 'password_too_short'
      ? 'Password must be at least 8 characters.'
      : 'Password must be 256 characters or fewer.',
    'IllegalArgumentException',
    code,
  );
}

function duplicateEmail(c: Context<AppEnv>): Response {
  return jsonError(c, 409, 'The email address is already in use.', 'Conflict', 'email_in_use');
}

function currentPasswordIncorrect(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    403,
    'The current password is incorrect.',
    'Forbidden',
    'current_password_incorrect',
  );
}

function currentPasswordRequired(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    400,
    'currentPassword is required.',
    'IllegalArgumentException',
    'current_password_required',
  );
}

function mailSender(c: Context<AppEnv>): MailSender | null {
  if (c.env.MAIL_SENDER) return c.env.MAIL_SENDER;
  if (!isMailConfigured({ apiKey: c.env.RESEND_API_KEY, from: c.env.MAIL_FROM })) return null;
  return createResendMailSender({ apiKey: c.env.RESEND_API_KEY, from: c.env.MAIL_FROM });
}

function mailConfigurationError(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    503,
    'Email delivery is not configured.',
    'ServiceUnavailable',
    'mail_not_configured',
  );
}

function mailDeliveryError(c: Context<AppEnv>): Response {
  return jsonError(c, 502, 'Email delivery failed.', 'BadGateway', 'mail_delivery_failed');
}

async function deliverCode(
  sender: MailSender,
  purpose: AccountChallengePurpose,
  email: string,
  code: string,
): Promise<void> {
  if (purpose === PASSWORD_RESET_PURPOSE && sender.sendPasswordResetCode) {
    await sender.sendPasswordResetCode(email, code);
    return;
  }
  if (purpose === EMAIL_CHANGE_PURPOSE && sender.sendEmailChangeCode) {
    await sender.sendEmailChangeCode(email, code);
    return;
  }
  if (purpose === ACCOUNT_RESTORE_PURPOSE && sender.sendAccountRestoreCode) {
    await sender.sendAccountRestoreCode(email, code);
    return;
  }
  await sender.sendVerificationCode(email, code);
}

async function deliverManagedCode(
  c: Context<AppEnv>,
  purpose: AccountChallengePurpose,
  email: string,
  code: string,
): Promise<Response | null> {
  const sender = mailSender(c);
  if (!sender) return mailConfigurationError(c);
  try {
    await deliverCode(sender, purpose, email, code);
    return null;
  } catch (error) {
    if (error instanceof MailError && error.code === 'mail_not_configured') {
      return mailConfigurationError(c);
    }
    if (!(error instanceof MailError)) console.error('[account] email delivery failed', { reason: 'adapter' });
    return mailDeliveryError(c);
  }
}

async function deliverRecoveryCode(
  c: Context<AppEnv>,
  email: string,
  code: string,
): Promise<boolean> {
  const sender = mailSender(c);
  if (!sender) return false;
  try {
    await deliverCode(sender, PASSWORD_RESET_PURPOSE, email, code);
    return true;
  } catch (error) {
    if (!(error instanceof MailError)) console.error('[account] password reset email delivery failed', { reason: 'adapter' });
    return false;
  }
}

function challengeResponse(
  c: Context<AppEnv>,
  challengeId: string,
  expiresAt: number,
  sentAt: number,
  email?: string,
): Response {
  return c.json(
    {
      ...(email ? { email } : {}),
      challengeId,
      expiresAt,
      resendAfter: sentAt + ACCOUNT_CHALLENGE_RESEND_DELAY_MS,
    },
    202,
  );
}

function passwordResetResponse(
  c: Context<AppEnv>,
  challengeId: string,
  expiresAt: number,
  sentAt: number,
): Response {
  return c.json(
    {
      message: PASSWORD_RESET_GENERIC_MESSAGE,
      challengeId,
      expiresAt,
      resendAfter: sentAt + ACCOUNT_CHALLENGE_RESEND_DELAY_MS,
    },
    202,
  );
}

function passwordResetResendResponse(
  c: Context<AppEnv>,
  challengeId: string,
  now: number,
): Response {
  return passwordResetResponse(
    c,
    challengeId,
    now + ACCOUNT_CHALLENGE_CODE_TTL_MS,
    now,
  );
}

function resendCooldown(c: Context<AppEnv>, resendAt: number): Response {
  const response = jsonError(
    c,
    429,
    'Please wait before requesting another code.',
    'TooManyRequests',
    'resend_cooldown',
  );
  response.headers.set('Retry-After', String(Math.max(1, Math.ceil((resendAt - Date.now()) / 1000))));
  return response;
}

function challengeIdFromBody(body: PasswordResetInput | EmailChangeInput): string | null {
  return (
    asString(body.challengeId) ??
    ('resetId' in body ? asString(body.resetId) : null) ??
    ('emailChangeId' in body ? asString(body.emailChangeId) : null)
  );
}

function newPasswordFromBody(body: PasswordResetInput): string | null {
  return asPassword(body.newPassword ?? body.new_password ?? body.password);
}

function currentPasswordFromBody(body: EmailChangeStartInput | EmailChangeInput): string | null {
  return asPassword(body.currentPassword ?? body.current_password);
}

async function challengeRateLimit(
  c: Context<AppEnv>,
  purpose: AccountChallengePurpose,
  email: string,
): Promise<Response | null> {
  const clientKey = getClientKey(c.req.raw);
  const [ipResult, emailResult] = await Promise.all([
    recordAccountChallengeIpAttempt(c.env, purpose, clientKey),
    recordAccountChallengeEmailAttempt(c.env, purpose, email),
  ]);
  if (ipResult.allowed && emailResult.allowed) return null;

  const retryAfter = Math.max(ipResult.retryAfter, emailResult.retryAfter);
  const response = jsonError(
    c,
    429,
    'Too many requests. Try again later.',
    'TooManyRequests',
    purpose === PASSWORD_RESET_PURPOSE
      ? 'password_reset_rate_limited'
      : purpose === EMAIL_CHANGE_PURPOSE
        ? 'email_change_rate_limited'
        : 'account_restore_rate_limited',
  );
  if (retryAfter > 0) response.headers.set('Retry-After', String(Math.ceil(retryAfter / 1000)));
  return response;
}

async function turnstileError(
  c: Context<AppEnv>,
  body:
    | PasswordResetStartInput
    | PasswordResetInput
    | EmailChangeStartInput
    | EmailChangeInput
    | AccountDeletionInput
    | AccountRestoreInput,
  message: string,
): Promise<Response | null> {
  if (!c.env.TURNSTILE_SECRET_KEY?.trim()) return null;
  const clientKey = getClientKey(c.req.raw);
  const valid = await verifyTurnstileToken(
    turnstileTokenFromBody(body),
    c.env.TURNSTILE_SECRET_KEY,
    { remoteIp: clientKey === 'unknown' ? undefined : clientKey },
  );
  return valid ? null : jsonError(c, 403, message, 'Forbidden', 'turnstile_required');
}

function requireCookieSession(c: Context<AppEnv>): Response | null {
  if (c.get('authMethod') === 'cookie' && c.get('webSession')) return null;
  return jsonError(c, 401, 'A web session is required.', 'Unauthorized', 'unauthorized');
}

async function resetChallengeFromBody(
  c: Context<AppEnv>,
  body: PasswordResetInput,
) {
  const challengeId = challengeIdFromBody(body);
  if (challengeId) return findAccountChallengeById(c.env.DB, challengeId, PASSWORD_RESET_PURPOSE);
  const email = normalizeEmail(body.email);
  if (!email) return null;
  const user = await findUserByEmail(c.env.DB, email);
  return user
    ? findAccountChallengeByUserAndPurpose(c.env.DB, user.id, PASSWORD_RESET_PURPOSE)
    : null;
}

async function emailChangeChallengeFromBody(
  c: Context<AppEnv>,
  body: EmailChangeInput,
) {
  const userId = c.get('user').id;
  const challengeId = challengeIdFromBody(body);
  return challengeId
    ? findAccountChallengeById(c.env.DB, challengeId, EMAIL_CHANGE_PURPOSE, userId)
    : findAccountChallengeByUserAndPurpose(c.env.DB, userId, EMAIL_CHANGE_PURPOSE);
}

function deletionCurrentPasswordFromBody(body: AccountDeletionInput): string | null {
  return asPassword(body.currentPassword ?? body.current_password);
}

function deletionConfirmationFromBody(body: AccountDeletionInput): string | null {
  return asString(body.confirmation ?? body.confirm ?? body.confirmText);
}

async function restoreChallengeFromBody(
  c: Context<AppEnv>,
  body: AccountRestoreInput,
) {
  const challengeId = asString(body.challengeId);
  if (challengeId) {
    return findAccountChallengeById(c.env.DB, challengeId, ACCOUNT_RESTORE_PURPOSE);
  }
  const email = normalizeEmail(body.email);
  if (!email) return null;
  const user = await findUserByEmail(c.env.DB, email);
  return user
    ? findAccountChallengeByUserAndPurpose(c.env.DB, user.id, ACCOUNT_RESTORE_PURPOSE)
    : null;
}

routes.post('/auth/password/reset/start', async (c) => {
  const body = await readJson<PasswordResetStartInput>(c);
  const email = normalizeEmail(body?.email);
  if (!email || !isValidEmail(email)) return invalidEmail(c);

  const rateLimitError = await challengeRateLimit(c, PASSWORD_RESET_PURPOSE, email);
  if (rateLimitError) return rateLimitError;
  const turnstileFailure = await turnstileError(c, body ?? {}, 'Password reset verification failed.');
  if (turnstileFailure) return turnstileFailure;

  const sentAt = Date.now();
  const expiresAt = sentAt + ACCOUNT_CHALLENGE_CODE_TTL_MS;
  const challengeId = generateUserId();
  const user = await findUserByEmail(c.env.DB, email);
  if (!user || user.status === 'disabled' || user.status === 'pending_deletion') {
    return passwordResetResponse(c, challengeId, expiresAt, sentAt);
  }

  const code = generateVerificationCode();
  if (!await deliverRecoveryCode(c, email, code)) {
    return passwordResetResponse(c, challengeId, expiresAt, sentAt);
  }

  const previous = await findAccountChallengeByUserAndPurpose(c.env.DB, user.id, PASSWORD_RESET_PURPOSE);
  const saved = await upsertAccountChallenge(c.env.DB, {
    id: previous?.id ?? challengeId,
    user_id: user.id,
    purpose: PASSWORD_RESET_PURPOSE,
    email,
    code_hash: await sha256Hex(new TextEncoder().encode(code)),
    attempts: 0,
    last_sent_at: sentAt,
    expires_at: expiresAt,
    created_at: previous?.created_at ?? sentAt,
    updated_at: sentAt,
  });
  return passwordResetResponse(c, saved?.id ?? challengeId, expiresAt, sentAt);
});

routes.post('/auth/password/reset/resend', async (c) => {
  const body = await readJson<PasswordResetInput>(c);
  const publicChallengeId = challengeIdFromBody(body ?? {}) ?? generateUserId();
  const now = Date.now();
  const genericResponse = () => passwordResetResendResponse(c, publicChallengeId, Date.now());
  const clientKey = getClientKey(c.req.raw);
  const ipRateLimit = await recordAccountChallengeIpAttempt(c.env, PASSWORD_RESET_PURPOSE, clientKey);
  if (!ipRateLimit.allowed) return genericResponse();
  const turnstileFailure = await turnstileError(c, body ?? {}, 'Password reset verification failed.');
  if (turnstileFailure) return turnstileFailure;

  const challenge = await resetChallengeFromBody(c, body ?? {});
  if (!challenge || challenge.expires_at <= now) return genericResponse();
  if (challenge.last_sent_at + ACCOUNT_CHALLENGE_RESEND_DELAY_MS > now) return genericResponse();

  const emailRateLimit = await recordAccountChallengeEmailAttempt(c.env, PASSWORD_RESET_PURPOSE, challenge.email);
  if (!emailRateLimit.allowed) return genericResponse();

  const sentAt = Date.now();
  const claimed = await claimAccountChallengeResend(c.env.DB, challenge, sentAt);
  if (!claimed) return genericResponse();
  const code = generateVerificationCode();
  if (!await deliverRecoveryCode(c, challenge.email, code)) return genericResponse();
  const expiresAt = sentAt + ACCOUNT_CHALLENGE_CODE_TTL_MS;
  const updated = await updateAccountChallenge(
    c.env.DB,
    challenge,
    await sha256Hex(new TextEncoder().encode(code)),
    sentAt,
    expiresAt,
  );
  return updated
    ? passwordResetResponse(c, publicChallengeId, expiresAt, sentAt)
    : genericResponse();
});

routes.post('/auth/password/reset/verify', async (c) => {
  const body = await readJson<PasswordResetInput>(c);
  const code = asString(body?.code);
  const newPassword = newPasswordFromBody(body ?? {});
  if (!code || !isSixDigitCode(code)) return invalidVerification(c);
  if (!newPassword) return jsonError(c, 400, 'newPassword is required.');
  if (newPassword.length < 8) return passwordError(c, 'password_too_short');
  if (newPassword.length > 256) return passwordError(c, 'password_too_long');

  const challenge = await resetChallengeFromBody(c, body ?? {});
  if (!challenge) return invalidVerification(c);
  const now = Date.now();
  if (challenge.expires_at <= now) return invalidVerification(c);
  if (challenge.attempts >= ACCOUNT_CHALLENGE_MAX_ATTEMPTS) return attemptsExhausted(c);

  const codeHash = await sha256Hex(new TextEncoder().encode(code));
  if (!timingSafeEqual(codeHash, challenge.code_hash)) {
    const incremented = await incrementAccountChallengeAttempts(
      c.env.DB,
      challenge.id,
      PASSWORD_RESET_PURPOSE,
      now,
    );
    return incremented ? invalidVerification(c) : attemptsExhausted(c);
  }

  const salt = createSalt();
  const updated = await completePasswordReset(
    c.env.DB,
    challenge,
    await hashPassword(newPassword, salt),
    salt,
    now,
  );
  if (!updated) return invalidVerification(c);
  await deleteUserTokens(c.env.DB, challenge.user_id);
  await revokeUserWebSessions(c.env.DB, challenge.user_id, now);
  await writeAudit(c, {
    actorUserId: null,
    targetUserId: challenge.user_id,
    targetResource: `user:${challenge.user_id}`,
    action: AUDIT_ACTIONS.ACCOUNT_PASSWORD_RESET,
    result: 'success',
  });
  return c.body(null, 204);
});

routes.post('/user/deletion', authMiddleware, async (c) => {
  const sessionError = requireCookieSession(c);
  if (sessionError) return sessionError;

  const body = await readJson<AccountDeletionInput>(c);
  const currentPassword = deletionCurrentPasswordFromBody(body ?? {});
  const confirmation = deletionConfirmationFromBody(body ?? {});
  if (!currentPassword) return currentPasswordRequired(c);
  if (confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
    return jsonError(
      c,
      400,
      `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm account deletion.`,
      'IllegalArgumentException',
      'account_deletion_confirmation_required',
    );
  }

  const user = c.get('user');
  if (user.role === 'admin') {
    return jsonError(
      c,
      403,
      'Administrator account deletion is not available.',
      'Forbidden',
      'admin_deletion_not_allowed',
    );
  }
  if (!await verifyPassword(currentPassword, user.salt, user.password)) {
    return currentPasswordIncorrect(c);
  }

  const rateLimitError = await challengeRateLimit(c, ACCOUNT_RESTORE_PURPOSE, user.email);
  if (rateLimitError) return rateLimitError;
  const turnstileFailure = await turnstileError(
    c,
    body ?? {},
    'Account deletion verification failed.',
  );
  if (turnstileFailure) return turnstileFailure;

  const now = Date.now();
  const deletionAt = now + ACCOUNT_DELETION_GRACE_PERIOD_MS;
  const code = generateVerificationCode();
  if (!mailSender(c)) return mailConfigurationError(c);

  const challengeId = generateUserId();
  const challenge = {
    id: challengeId,
    user_id: user.id,
    purpose: ACCOUNT_RESTORE_PURPOSE,
    email: user.email,
    code_hash: await sha256Hex(new TextEncoder().encode(code)),
    attempts: 0,
    last_sent_at: now,
    expires_at: now + ACCOUNT_RESTORE_CODE_TTL_MS,
    created_at: now,
    updated_at: now,
  };
  const started = await startAccountDeletion(c.env.DB, user.id, deletionAt, challenge);
  if (!started) {
    const pendingUser = await findUserById(c.env.DB, user.id);
    const pendingChallenge = await findAccountChallengeByUserAndPurpose(
      c.env.DB,
      user.id,
      ACCOUNT_RESTORE_PURPOSE,
    );
    if (
      pendingUser?.status === 'pending_deletion' &&
      typeof pendingUser.deletion_requested_at === 'number' &&
      pendingChallenge
    ) {
      clearWebSessionCookies(c);
      return c.json({
        challengeId: pendingChallenge.id,
        deletionAt: pendingUser.deletion_requested_at,
        restoreUntil: pendingUser.deletion_requested_at,
        status: 'pending_deletion',
      }, 202);
    }
    return jsonError(
      c,
      409,
      'The account is already pending deletion.',
      'Conflict',
      'account_deletion_already_pending',
    );
  }

  const deliveryError = await deliverManagedCode(c, ACCOUNT_RESTORE_PURPOSE, user.email, code);
  if (deliveryError) {
    await restoreAccount(c.env.DB, challenge, Date.now());
    return deliveryError;
  }

  await deleteUserTokens(c.env.DB, user.id);
  await revokeUserWebSessions(c.env.DB, user.id, now);
  await deleteUserServerSessions(c.env.DB, user.id);
  clearWebSessionCookies(c);
  await writeAudit(c, {
    actorUserId: user.id,
    targetUserId: user.id,
    targetResource: `user:${user.id}`,
    action: AUDIT_ACTIONS.ACCOUNT_DELETION_REQUEST,
    result: 'success',
    metadata: { deletionAt },
  });
  return c.json({
    challengeId,
    deletionAt,
    restoreUntil: deletionAt,
    status: 'pending_deletion',
  }, 202);
});

routes.post('/auth/account/restore', async (c) => {
  const body = await readJson<AccountRestoreInput>(c);
  const email = normalizeEmail(body?.email);
  const code = asString(body?.code);
  if (!email || !isValidEmail(email) || !code || !isSixDigitCode(code)) {
    return invalidVerification(c);
  }

  const rateLimitError = await challengeRateLimit(c, ACCOUNT_RESTORE_PURPOSE, email);
  if (rateLimitError) return rateLimitError;
  const turnstileFailure = await turnstileError(
    c,
    body ?? {},
    'Account recovery verification failed.',
  );
  if (turnstileFailure) return turnstileFailure;

  const challenge = await restoreChallengeFromBody(c, body ?? {});
  if (!challenge || challenge.email !== email) return invalidVerification(c);
  const user = await findUserById(c.env.DB, challenge.user_id);
  if (!user || user.status !== 'pending_deletion') return invalidVerification(c);

  const now = Date.now();
  if (challenge.expires_at <= now) return invalidVerification(c);
  if (challenge.attempts >= ACCOUNT_CHALLENGE_MAX_ATTEMPTS) return attemptsExhausted(c);

  const codeHash = await sha256Hex(new TextEncoder().encode(code));
  if (!timingSafeEqual(codeHash, challenge.code_hash)) {
    const incremented = await incrementAccountChallengeAttempts(
      c.env.DB,
      challenge.id,
      ACCOUNT_RESTORE_PURPOSE,
      now,
      user.id,
    );
    return incremented ? invalidVerification(c) : attemptsExhausted(c);
  }

  const restored = await restoreAccount(c.env.DB, challenge, now);
  if (!restored) return invalidVerification(c);
  await writeAudit(c, {
    actorUserId: null,
    targetUserId: challenge.user_id,
    targetResource: `user:${challenge.user_id}`,
    action: AUDIT_ACTIONS.ACCOUNT_DELETION_RESTORE,
    result: 'success',
  });
  return c.body(null, 204);
});

routes.post('/user/email/change/start', authMiddleware, async (c) => {
  const sessionError = requireCookieSession(c);
  if (sessionError) return sessionError;
  const body = await readJson<EmailChangeStartInput>(c);
  const currentPassword = currentPasswordFromBody(body ?? {});
  const newEmail = normalizeEmail(body?.newEmail ?? body?.new_email ?? body?.email);
  if (!currentPassword || !newEmail) return jsonError(c, 400, 'currentPassword and newEmail are required.');
  if (!isValidEmail(newEmail)) return invalidEmail(c);

  const user = c.get('user');
  if (!await verifyPassword(currentPassword, user.salt, user.password)) return currentPasswordIncorrect(c);
  const existing = await findUserByEmail(c.env.DB, newEmail);
  if (existing && existing.id !== user.id) return duplicateEmail(c);
  if (existing?.id === user.id) return duplicateEmail(c);

  const rateLimitError = await challengeRateLimit(c, EMAIL_CHANGE_PURPOSE, newEmail);
  if (rateLimitError) return rateLimitError;
  const turnstileFailure = await turnstileError(c, body ?? {}, 'Email change verification failed.');
  if (turnstileFailure) return turnstileFailure;

  const code = generateVerificationCode();
  const deliveryError = await deliverManagedCode(c, EMAIL_CHANGE_PURPOSE, newEmail, code);
  if (deliveryError) return deliveryError;
  const sentAt = Date.now();
  const expiresAt = sentAt + ACCOUNT_CHALLENGE_CODE_TTL_MS;
  const previous = await findAccountChallengeByUserAndPurpose(c.env.DB, user.id, EMAIL_CHANGE_PURPOSE);
  const saved = await upsertAccountChallenge(c.env.DB, {
    id: previous?.id ?? generateUserId(),
    user_id: user.id,
    purpose: EMAIL_CHANGE_PURPOSE,
    email: newEmail,
    code_hash: await sha256Hex(new TextEncoder().encode(code)),
    attempts: 0,
    last_sent_at: sentAt,
    expires_at: expiresAt,
    created_at: previous?.created_at ?? sentAt,
    updated_at: sentAt,
  });
  if (!saved) return invalidVerification(c);
  return challengeResponse(c, saved.id, expiresAt, sentAt, newEmail);
});

routes.post('/user/email/change/resend', authMiddleware, async (c) => {
  const sessionError = requireCookieSession(c);
  if (sessionError) return sessionError;
  const body = await readJson<EmailChangeInput>(c);
  const challenge = await emailChangeChallengeFromBody(c, body ?? {});
  if (!challenge) return invalidVerification(c);
  const now = Date.now();
  if (challenge.expires_at <= now) return invalidVerification(c);
  const resendAt = challenge.last_sent_at + ACCOUNT_CHALLENGE_RESEND_DELAY_MS;
  if (resendAt > now) return resendCooldown(c, resendAt);
  const duplicate = await findUserByEmail(c.env.DB, challenge.email);
  if (duplicate && duplicate.id !== c.get('user').id) return duplicateEmail(c);
  const rateLimitError = await challengeRateLimit(c, EMAIL_CHANGE_PURPOSE, challenge.email);
  if (rateLimitError) return rateLimitError;
  const turnstileFailure = await turnstileError(c, body ?? {}, 'Email change verification failed.');
  if (turnstileFailure) return turnstileFailure;
  const sentAt = Date.now();
  const claimed = await claimAccountChallengeResend(c.env.DB, challenge, sentAt);
  if (!claimed) return resendCooldown(c, sentAt + ACCOUNT_CHALLENGE_RESEND_DELAY_MS);
  const code = generateVerificationCode();
  const deliveryError = await deliverManagedCode(c, EMAIL_CHANGE_PURPOSE, challenge.email, code);
  if (deliveryError) return deliveryError;
  const expiresAt = sentAt + ACCOUNT_CHALLENGE_CODE_TTL_MS;
  const updated = await updateAccountChallenge(
    c.env.DB,
    challenge,
    await sha256Hex(new TextEncoder().encode(code)),
    sentAt,
    expiresAt,
  );
  if (!updated) return invalidVerification(c);
  return challengeResponse(c, challenge.id, expiresAt, sentAt, challenge.email);
});

async function completeEmailChangeRoute(c: Context<AppEnv>): Promise<Response> {
  const sessionError = requireCookieSession(c);
  if (sessionError) return sessionError;
  const body = await readJson<EmailChangeInput>(c);
  const suppliedCurrentPassword = currentPasswordFromBody(body ?? {});
  const user = c.get('user');
  if (!suppliedCurrentPassword) return currentPasswordRequired(c);
  if (!await verifyPassword(suppliedCurrentPassword, user.salt, user.password)) {
    return currentPasswordIncorrect(c);
  }
  const code = asString(body?.code);
  if (!code || !isSixDigitCode(code)) return invalidVerification(c);
  const challenge = await emailChangeChallengeFromBody(c, body ?? {});
  if (!challenge) return invalidVerification(c);
  const now = Date.now();
  if (challenge.expires_at <= now) return invalidVerification(c);
  if (challenge.attempts >= ACCOUNT_CHALLENGE_MAX_ATTEMPTS) return attemptsExhausted(c);

  const codeHash = await sha256Hex(new TextEncoder().encode(code));
  if (!timingSafeEqual(codeHash, challenge.code_hash)) {
    const incremented = await incrementAccountChallengeAttempts(
      c.env.DB,
      challenge.id,
      EMAIL_CHANGE_PURPOSE,
      now,
      user.id,
    );
    return incremented ? invalidVerification(c) : attemptsExhausted(c);
  }

  const duplicate = await findUserByEmail(c.env.DB, challenge.email);
  if (duplicate && duplicate.id !== user.id) return duplicateEmail(c);
  let updated = false;
  try {
    updated = await completeEmailChange(c.env.DB, challenge, challenge.email, now);
  } catch (error) {
    if (isConstraintViolation(error)) return duplicateEmail(c);
    throw error;
  }
  if (!updated) {
    const racedDuplicate = await findUserByEmail(c.env.DB, challenge.email);
    return racedDuplicate && racedDuplicate.id !== user.id ? duplicateEmail(c) : invalidVerification(c);
  }

  const currentSession = c.get('webSession');
  if (!currentSession) return requireCookieSession(c) ?? invalidVerification(c);
  await revokeOtherWebSessions(c.env.DB, user.id, currentSession.id, now);
  const updatedUser = await findUserById(c.env.DB, user.id);
  if (!updatedUser) return invalidVerification(c);
  await writeAudit(c, {
    actorUserId: user.id,
    targetUserId: user.id,
    targetResource: `user:${user.id}`,
    action: AUDIT_ACTIONS.ACCOUNT_EMAIL_CHANGE,
    result: 'success',
  });
  return c.json({ user: serializeUser(updatedUser, c.get('profile')) });
}

routes.put('/user/email', authMiddleware, completeEmailChangeRoute);
routes.post('/user/email', authMiddleware, completeEmailChangeRoute);

export default routes;
