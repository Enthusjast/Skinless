import { Hono } from "hono";
import type { Context } from "hono";
import {
  completePendingRegistration,
  deletePendingRegistration,
  findPendingRegistrationByEmail,
  findPendingRegistrationById,
  findPendingRegistrationByName,
  findProfileByName,
  findUserByEmail,
  findUserById,
  findRegistrationInviteByCodeHash,
  findRegistrationInviteById,
  findSiteSettings,
  incrementRegistrationChallengeAttempts,
  insertPendingRegistration,
  isConstraintViolation,
  updateRegistrationChallenge,
} from "../db/queries";
import {
  recordRegistrationEmailAttempt,
  recordRegistrationIpAttempt,
  getClientKey,
} from "../middleware/ratelimit";
import {
  createSalt,
  hashPassword,
  sha256Hex,
  timingSafeEqual,
} from "../utils/crypto";
import { jsonError, readJson } from "../utils/errors";
import {
  turnstileTokenFromBody,
  verifyTurnstileToken,
} from "../utils/turnstile";
import {
  REGISTRATION_CODE_TTL_MS,
  REGISTRATION_MAX_ATTEMPTS,
  REGISTRATION_RESEND_DELAY_MS,
} from "../utils/registration";
import {
  createResendMailSender,
  isMailConfigured,
  MailError,
  type MailSender,
} from "../utils/mail";
import { generateProfileId, generateUserId } from "../utils/uuid";
import { serializeUser } from "../utils/serializers";
import type {
  AppEnv,
  PendingRegistrationRecord,
  ProfileRecord,
  RegistrationChallengeRecord,
  RegistrationInviteRecord,
  SiteSettingsRecord,
  UserRecord,
} from "../types";

interface RegistrationStartInput {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  inviteCode?: unknown;
  invite_code?: unknown;
  turnstileToken?: unknown;
}

interface RegistrationChallengeInput {
  challengeId?: unknown;
  registrationId?: unknown;
  pendingId?: unknown;
  email?: unknown;
  code?: unknown;
}

const DUPLICATE_REGISTRATION_MESSAGE =
  "The email or game name is already in use.";
const INVALID_VERIFICATION_MESSAGE =
  "The verification code is invalid or expired.";

const routes = new Hono<AppEnv>();

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPassword(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidProfileName(name: string): boolean {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}

function isSixDigitCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

function isInviteAvailable(
  invite: RegistrationInviteRecord | null,
  now: number,
): invite is RegistrationInviteRecord {
  return Boolean(
    invite &&
    invite.revoked_at === null &&
    (invite.expires_at === null || invite.expires_at > now) &&
    invite.use_count < invite.use_limit,
  );
}

function registrationSettings(
  record: SiteSettingsRecord | null,
  c: Context<AppEnv>,
): SiteSettingsRecord | Response {
  if (record) return record;
  return jsonError(
    c,
    500,
    "Registration settings are not initialized.",
    "InternalServerError",
    "internal_server_error",
  );
}

function registrationPolicyError(
  c: Context<AppEnv>,
  settings: SiteSettingsRecord,
): Response | null {
  if (settings.registration_mode === "closed") {
    return jsonError(
      c,
      403,
      "Registration is currently closed.",
      "Forbidden",
      "registration_closed",
    );
  }
  return null;
}

function invalidInvite(c: Context<AppEnv>, required: boolean): Response {
  return jsonError(
    c,
    400,
    required
      ? "A valid invitation code is required."
      : "The invitation code is invalid or unavailable.",
    "IllegalArgumentException",
    required ? "invite_required" : "invalid_invite",
  );
}

function duplicateRegistration(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    409,
    DUPLICATE_REGISTRATION_MESSAGE,
    "Conflict",
    "conflict",
  );
}

function invalidVerification(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    400,
    INVALID_VERIFICATION_MESSAGE,
    "IllegalArgumentException",
    "invalid_verification_code",
  );
}

function attemptsExhausted(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    429,
    "Too many verification attempts. Request a new code.",
    "TooManyRequests",
    "verification_attempts_exhausted",
  );
}

function mailSender(c: Context<AppEnv>): MailSender | null {
  if (c.env.MAIL_SENDER) return c.env.MAIL_SENDER;
  if (
    !isMailConfigured({ apiKey: c.env.RESEND_API_KEY, from: c.env.MAIL_FROM })
  )
    return null;
  return createResendMailSender({
    apiKey: c.env.RESEND_API_KEY,
    from: c.env.MAIL_FROM,
  });
}

function mailConfigurationError(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    503,
    "Email delivery is not configured.",
    "ServiceUnavailable",
    "mail_not_configured",
  );
}

function mailDeliveryError(c: Context<AppEnv>): Response {
  return jsonError(
    c,
    502,
    "Email delivery failed.",
    "BadGateway",
    "mail_delivery_failed",
  );
}

async function deliverCode(
  c: Context<AppEnv>,
  email: string,
  code: string,
): Promise<Response | null> {
  const sender = mailSender(c);
  if (!sender) return mailConfigurationError(c);
  try {
    await sender.sendVerificationCode(email, code);
    return null;
  } catch (error) {
    if (error instanceof MailError && error.code === "mail_not_configured")
      return mailConfigurationError(c);
    if (!(error instanceof MailError))
      console.error("[registration] email delivery failed", {
        reason: "adapter",
      });
    return mailDeliveryError(c);
  }
}

async function registrationRateLimit(
  c: Context<AppEnv>,
  email: string,
): Promise<Response | null> {
  const clientKey = getClientKey(c.req.raw);
  const ipResult = await recordRegistrationIpAttempt(c.env, clientKey);
  const emailResult = await recordRegistrationEmailAttempt(c.env, email);
  if (ipResult.allowed && emailResult.allowed) return null;

  const retryAfter = Math.max(ipResult.retryAfter, emailResult.retryAfter);
  const response = jsonError(
    c,
    429,
    "Too many registration attempts. Try again later.",
    "TooManyRequests",
    "registration_rate_limited",
  );
  if (retryAfter > 0)
    response.headers.set("Retry-After", String(Math.ceil(retryAfter / 1000)));
  return response;
}

async function verifyRegistrationTurnstile(
  c: Context<AppEnv>,
  body: RegistrationStartInput,
): Promise<Response | null> {
  if (!c.env.TURNSTILE_SECRET_KEY?.trim()) return null;
  const valid = await verifyTurnstileToken(
    turnstileTokenFromBody(body),
    c.env.TURNSTILE_SECRET_KEY,
    {
      remoteIp:
        getClientKey(c.req.raw) === "unknown"
          ? undefined
          : getClientKey(c.req.raw),
    },
  );
  return valid
    ? null
    : jsonError(
        c,
        403,
        "Registration verification failed.",
        "Forbidden",
        "turnstile_required",
      );
}

function verificationCode(): string {
  const values = new Uint32Array(1);
  const range = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return String(values[0] % range).padStart(6, "0");
}

function challengeResponse(
  c: Context<AppEnv>,
  pendingId: string,
  expiresAt: number,
  sentAt: number,
): Response {
  return c.json(
    {
      challengeId: pendingId,
      expiresAt,
      resendAfter: sentAt + REGISTRATION_RESEND_DELAY_MS,
    },
    202,
  );
}

function challengeIdFromBody(body: RegistrationChallengeInput): string | null {
  return (
    asString(body.challengeId) ??
    asString(body.registrationId) ??
    asString(body.pendingId)
  );
}

async function pendingFromBody(
  c: Context<AppEnv>,
  body: RegistrationChallengeInput,
) {
  const challengeId = challengeIdFromBody(body);
  if (challengeId) return findPendingRegistrationById(c.env.DB, challengeId);
  const email = asString(body.email)?.toLowerCase();
  return email ? findPendingRegistrationByEmail(c.env.DB, email) : null;
}

async function inviteForPending(
  c: Context<AppEnv>,
  pending: { invite_id: string | null },
  now: number,
): Promise<RegistrationInviteRecord | null> {
  if (!pending.invite_id) return null;
  const invite = await findRegistrationInviteById(c.env.DB, pending.invite_id);
  return isInviteAvailable(invite, now) ? invite : null;
}

routes.post("/register/start", async (c) => {
  const body = await readJson<RegistrationStartInput>(c);
  const email = asString(body?.email)?.toLowerCase();
  const password = asPassword(body?.password);
  const name = asString(body?.name);
  if (!email || !password || !name) {
    return jsonError(c, 400, "email, password and name are required.");
  }
  if (!isValidEmail(email)) {
    return jsonError(
      c,
      400,
      "A valid email address is required.",
      "IllegalArgumentException",
      "invalid_email",
    );
  }
  if (password.length < 8) {
    return jsonError(
      c,
      400,
      "Password must be at least 8 characters.",
      "IllegalArgumentException",
      "password_too_short",
    );
  }
  if (password.length > 256) {
    return jsonError(
      c,
      400,
      "Password must be 256 characters or fewer.",
      "IllegalArgumentException",
      "password_too_long",
    );
  }
  if (!isValidProfileName(name)) {
    return jsonError(
      c,
      400,
      "Game name must be 3-16 letters, numbers or underscores.",
      "IllegalArgumentException",
      "invalid_profile_name",
    );
  }

  const settingsResult = registrationSettings(
    await findSiteSettings(c.env.DB),
    c,
  );
  if (settingsResult instanceof Response) return settingsResult;
  const policyError = registrationPolicyError(c, settingsResult);
  if (policyError) return policyError;

  const now = Date.now();
  const rawInviteCode = asString(body?.inviteCode ?? body?.invite_code);
  let invite: RegistrationInviteRecord | null = null;
  if (settingsResult.registration_mode === "invite" && !rawInviteCode)
    return invalidInvite(c, true);
  if (rawInviteCode) {
    invite = await findRegistrationInviteByCodeHash(
      c.env.DB,
      await sha256Hex(new TextEncoder().encode(rawInviteCode)),
    );
    if (!isInviteAvailable(invite, now)) return invalidInvite(c, false);
  }

  const existingUser = await findUserByEmail(c.env.DB, email);
  const existingProfile = await findProfileByName(c.env.DB, name);
  const pendingByEmail = await findPendingRegistrationByEmail(c.env.DB, email);
  const pendingByName = await findPendingRegistrationByName(c.env.DB, name);
  for (const pending of [pendingByEmail, pendingByName]) {
    if (pending && pending.expires_at <= now)
      await deletePendingRegistration(c.env.DB, pending.id);
  }
  const activePendingByEmail =
    pendingByEmail && pendingByEmail.expires_at > now ? pendingByEmail : null;
  const activePendingByName =
    pendingByName && pendingByName.expires_at > now ? pendingByName : null;
  if (
    existingUser ||
    existingProfile ||
    activePendingByEmail ||
    activePendingByName
  ) {
    return duplicateRegistration(c);
  }

  if (!mailSender(c)) return mailConfigurationError(c);
  const rateLimitError = await registrationRateLimit(c, email);
  if (rateLimitError) return rateLimitError;
  const turnstileError = await verifyRegistrationTurnstile(c, body ?? {});
  if (turnstileError) return turnstileError;

  const code = verificationCode();
  const sentAt = Date.now();
  const expiresAt = sentAt + REGISTRATION_CODE_TTL_MS;
  const deliveryError = await deliverCode(c, email, code);
  if (deliveryError) return deliveryError;

  const salt = createSalt();
  const pending: PendingRegistrationRecord = {
    id: generateUserId(),
    email,
    password_hash: await hashPassword(password, salt),
    salt,
    profile_name: name,
    invite_id: invite?.id ?? null,
    created_at: sentAt,
    updated_at: sentAt,
    expires_at: expiresAt,
  };
  const challenge: RegistrationChallengeRecord = {
    id: pending.id,
    pending_registration_id: pending.id,
    code_hash: await sha256Hex(new TextEncoder().encode(code)),
    attempts: 0,
    last_sent_at: sentAt,
    expires_at: expiresAt,
    created_at: sentAt,
    updated_at: sentAt,
  };
  try {
    await insertPendingRegistration(c.env.DB, pending, challenge);
  } catch (error) {
    if (isConstraintViolation(error)) return duplicateRegistration(c);
    throw error;
  }
  return challengeResponse(c, pending.id, expiresAt, sentAt);
});

routes.post("/register/resend", async (c) => {
  const body = await readJson<RegistrationChallengeInput>(c);
  const pending = await pendingFromBody(c, body ?? {});
  if (!pending) return invalidVerification(c);

  const now = Date.now();
  if (pending.expires_at <= now || pending.challenge_expires_at <= now) {
    return invalidVerification(c);
  }
  const resendAt = pending.last_sent_at + REGISTRATION_RESEND_DELAY_MS;
  if (resendAt > now) {
    const response = jsonError(
      c,
      429,
      "Please wait before requesting another code.",
      "TooManyRequests",
      "resend_cooldown",
    );
    response.headers.set(
      "Retry-After",
      String(Math.ceil((resendAt - now) / 1000)),
    );
    return response;
  }
  const settingsResult = registrationSettings(
    await findSiteSettings(c.env.DB),
    c,
  );
  if (settingsResult instanceof Response) return settingsResult;
  const policyError = registrationPolicyError(c, settingsResult);
  if (policyError) return policyError;
  if (pending.invite_id && !(await inviteForPending(c, pending, now)))
    return invalidInvite(c, false);

  const rateLimitError = await registrationRateLimit(c, pending.email);
  if (rateLimitError) return rateLimitError;
  if (!mailSender(c)) return mailConfigurationError(c);

  const code = verificationCode();
  const sentAt = Date.now();
  const expiresAt = sentAt + REGISTRATION_CODE_TTL_MS;
  const deliveryError = await deliverCode(c, pending.email, code);
  if (deliveryError) return deliveryError;
  const updated = await updateRegistrationChallenge(
    c.env.DB,
    pending.id,
    pending.challenge_id,
    await sha256Hex(new TextEncoder().encode(code)),
    sentAt,
    expiresAt,
  );
  if (!updated) return invalidVerification(c);
  return challengeResponse(c, pending.id, expiresAt, sentAt);
});

routes.post("/register/verify", async (c) => {
  const body = await readJson<RegistrationChallengeInput>(c);
  const code = asString(body?.code);
  if (!code || !isSixDigitCode(code)) return invalidVerification(c);
  const pending = await pendingFromBody(c, body ?? {});
  if (!pending) return invalidVerification(c);

  const now = Date.now();
  if (pending.expires_at <= now || pending.challenge_expires_at <= now)
    return invalidVerification(c);
  if (pending.attempts >= REGISTRATION_MAX_ATTEMPTS)
    return attemptsExhausted(c);

  const codeHash = await sha256Hex(new TextEncoder().encode(code));
  if (!timingSafeEqual(codeHash, pending.code_hash)) {
    const incremented = await incrementRegistrationChallengeAttempts(
      c.env.DB,
      pending.challenge_id,
      now,
    );
    return incremented ? invalidVerification(c) : attemptsExhausted(c);
  }

  if (pending.invite_id && !(await inviteForPending(c, pending, now)))
    return invalidInvite(c, false);

  const user: UserRecord = {
    id: generateUserId(),
    email: pending.email,
    password: pending.password_hash,
    salt: pending.salt,
    role:
      c.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() === pending.email
        ? "admin"
        : "user",
    created_at: now,
    updated_at: now,
    email_verified_at: now,
    status: "active",
  };
  const profile: ProfileRecord = {
    id: generateProfileId(),
    user_id: user.id,
    name: pending.profile_name,
    skin_hash: null,
    cape_hash: null,
    skin_model: "classic",
    created_at: now,
    updated_at: now,
  };

  try {
    const configuredBootstrap = c.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() === pending.email;
    const bootstrapEnabled = !c.env.BOOTSTRAP_ADMIN_EMAIL?.trim() || configuredBootstrap;
    const created = await completePendingRegistration(
      c.env.DB,
      pending,
      user,
      profile,
      bootstrapEnabled,
    );
    if (!created) return duplicateRegistration(c);
  } catch (error) {
    if (isConstraintViolation(error)) return duplicateRegistration(c);
    throw error;
  }
  const createdUser = await findUserById(c.env.DB, user.id);
  return c.json({ user: serializeUser(createdUser ?? user, profile) }, 201);
});

export default routes;
