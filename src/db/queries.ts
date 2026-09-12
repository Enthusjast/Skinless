import type {
  ProfileRecord,
  TokenRecord,
  UserRecord,
  UserRole,
  UserWithProfile,
  SkinModel,
  PendingRegistrationRecord,
  RegistrationChallengeRecord,
  RegistrationInviteRecord,
  SiteSettingsRecord,
  WebSessionRecord,
  AccountChallengeRecord,
} from "../types";
import {
  ACCOUNT_CHALLENGE_MAX_ATTEMPTS,
  ACCOUNT_CHALLENGE_RESEND_DELAY_MS,
  type AccountChallengePurpose,
} from "../utils/account";
import type { RegistrationSettingsValues } from "../utils/registration";
import type { TextureType, TextureWardrobeRecord } from "../utils/wardrobe";

export interface TokenContextRow extends TokenRecord {
  user_email: string;
  user_password: string;
  user_salt: string;
  user_role: UserRole;
  user_created_at: number;
  user_updated_at: number;
  profile_name: string;
  skin_hash: string | null;
  cape_hash: string | null;
  skin_model: SkinModel;
}

export interface ServerSessionRecord {
  server_id: string;
  profile_id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface WebSessionSummary {
  id: string;
  device_label: string;
  created_at: number;
  last_used_at: number;
}

export interface PendingRegistrationContext extends PendingRegistrationRecord {
  challenge_id: string;
  code_hash: string;
  attempts: number;
  last_sent_at: number;
  challenge_expires_at: number;
  challenge_created_at: number;
  challenge_updated_at: number;
}

export const MAX_PROFILES_PER_USER = 5;

export interface TextureProfileReference {
  id: string;
  name: string;
  asset: TextureType;
}

export async function findUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRecord | null> {
  return db
    .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE LIMIT 1")
    .bind(email)
    .first<UserRecord>();
}

export async function findUserById(
  db: D1Database,
  id: string,
): Promise<UserRecord | null> {
  return db
    .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
    .bind(id)
    .first<UserRecord>();
}

export async function findProfileByUserId(
  db: D1Database,
  userId: string,
): Promise<ProfileRecord | null> {
  return db
    .prepare(
      `SELECT * FROM profiles
       WHERE user_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .bind(userId)
    .first<ProfileRecord>();
}

export async function findDefaultProfileByUserId(
  db: D1Database,
  userId: string,
): Promise<ProfileRecord | null> {
  const user = await findUserById(db, userId);
  if (user?.default_profile_id) {
    const profile = await findProfileById(db, user.default_profile_id);
    if (profile?.user_id === userId) return profile;
  }
  return findProfileByUserId(db, userId);
}

export async function listProfilesByUserId(
  db: D1Database,
  userId: string,
): Promise<ProfileRecord[]> {
  const result = await db
    .prepare(
      `SELECT * FROM profiles
       WHERE user_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(userId)
    .all<ProfileRecord>();
  return result.results;
}

export async function findProfileById(
  db: D1Database,
  profileId: string,
): Promise<ProfileRecord | null> {
  return db
    .prepare("SELECT * FROM profiles WHERE id = ? LIMIT 1")
    .bind(profileId)
    .first<ProfileRecord>();
}

export async function findProfileByName(
  db: D1Database,
  name: string,
): Promise<ProfileRecord | null> {
  return db
    .prepare("SELECT * FROM profiles WHERE name = ? COLLATE NOCASE LIMIT 1")
    .bind(name)
    .first<ProfileRecord>();
}

export async function findProfileByIdForUser(
  db: D1Database,
  profileId: string,
  userId: string,
): Promise<ProfileRecord | null> {
  return db
    .prepare("SELECT * FROM profiles WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(profileId, userId)
    .first<ProfileRecord>();
}

export async function countProfilesByUserId(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function findTokenContext(
  db: D1Database,
  accessToken: string,
  now = Date.now(),
): Promise<TokenContextRow | null> {
  return db
    .prepare(
      `SELECT
        t.access_token, t.client_token, t.user_id, t.profile_id, t.created_at, t.expires_at,
        u.email AS user_email, u.password AS user_password, u.salt AS user_salt, u.role AS user_role,
        u.created_at AS user_created_at, u.updated_at AS user_updated_at,
        p.name AS profile_name, p.skin_hash, p.cape_hash, p.skin_model
       FROM tokens t
       INNER JOIN users u ON u.id = t.user_id
       INNER JOIN profiles p ON p.id = t.profile_id
       WHERE t.access_token = ? AND t.expires_at > ?
       LIMIT 1`,
    )
    .bind(accessToken, now)
    .first<TokenContextRow>();
}

export async function insertUserAndProfile(
  db: D1Database,
  user: UserRecord,
  profile: ProfileRecord,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, email, password, salt, role, created_at, updated_at, default_profile_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        user.id,
        user.email,
        user.password,
        user.salt,
        user.role,
        user.created_at,
        user.updated_at,
      ),
    db
      .prepare(
        `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        profile.id,
        profile.user_id,
        profile.name,
        profile.skin_hash,
        profile.cape_hash,
        profile.skin_model,
        profile.created_at ?? user.created_at,
        profile.updated_at ?? user.updated_at,
      ),
    db
      .prepare(
        "UPDATE users SET default_profile_id = ? WHERE id = ? AND default_profile_id IS NULL",
      )
      .bind(profile.id, user.id),
  ]);
}

export async function insertProfileBelowLimit(
  db: D1Database,
  profile: ProfileRecord,
  limit = MAX_PROFILES_PER_USER,
): Promise<boolean> {
  const timestamp = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM profiles WHERE user_id = ?) < ?`,
    )
    .bind(
      profile.id,
      profile.user_id,
      profile.name,
      profile.skin_hash,
      profile.cape_hash,
      profile.skin_model,
      profile.created_at ?? timestamp,
      profile.updated_at ?? timestamp,
      profile.user_id,
      limit,
    )
    .run();
  return (result.meta?.changes ?? 1) > 0;
}

export async function updateProfileName(
  db: D1Database,
  profileId: string,
  name: string,
  updatedAt: number,
): Promise<void> {
  await db
    .prepare("UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?")
    .bind(name, updatedAt, profileId)
    .run();
}

export async function setDefaultProfile(
  db: D1Database,
  userId: string,
  profileId: string,
  updatedAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE users
       SET default_profile_id = ?, updated_at = ?
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM profiles WHERE id = ? AND user_id = ?
       )`,
    )
    .bind(profileId, updatedAt, userId, profileId, userId)
    .run();
  return (result.meta?.changes ?? 1) > 0;
}

export async function deleteProfile(
  db: D1Database,
  profileId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM profiles WHERE id = ? AND user_id = ?")
    .bind(profileId, userId)
    .run();
  return (result.meta?.changes ?? 1) > 0;
}

export async function insertToken(
  db: D1Database,
  token: TokenRecord,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tokens (access_token, client_token, user_id, profile_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      token.access_token,
      token.client_token,
      token.user_id,
      token.profile_id,
      token.created_at,
      token.expires_at,
    )
    .run();
}

export async function rotateToken(
  db: D1Database,
  previous: string,
  token: TokenRecord,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM tokens WHERE access_token = ?").bind(previous),
    db
      .prepare(
        `INSERT INTO tokens (access_token, client_token, user_id, profile_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        token.access_token,
        token.client_token,
        token.user_id,
        token.profile_id,
        token.created_at,
        token.expires_at,
      ),
  ]);
}

export async function deleteToken(
  db: D1Database,
  accessToken: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM tokens WHERE access_token = ?")
    .bind(accessToken)
    .run();
}

export async function deleteUserTokens(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db.prepare("DELETE FROM tokens WHERE user_id = ?").bind(userId).run();
}

export async function insertWebSession(
  db: D1Database,
  session: WebSessionRecord,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO web_sessions
       (id, user_id, refresh_token_hash, csrf_token_hash, device_label, created_at, last_used_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      session.id,
      session.user_id,
      session.refresh_token_hash,
      session.csrf_token_hash,
      session.device_label,
      session.created_at,
      session.last_used_at,
      session.expires_at,
      session.revoked_at,
    )
    .run();
}

export async function findWebSessionById(
  db: D1Database,
  id: string,
): Promise<WebSessionRecord | null> {
  return db
    .prepare("SELECT * FROM web_sessions WHERE id = ? LIMIT 1")
    .bind(id)
    .first<WebSessionRecord>();
}

export async function rotateWebSession(
  db: D1Database,
  id: string,
  previousRefreshHash: string,
  refreshTokenHash: string,
  csrfTokenHash: string,
  lastUsedAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE web_sessions
       SET refresh_token_hash = ?, csrf_token_hash = ?, last_used_at = ?
       WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(refreshTokenHash, csrfTokenHash, lastUsedAt, id, previousRefreshHash)
    .run();
  return (result.meta?.changes ?? 1) > 0;
}

export async function touchWebSession(
  db: D1Database,
  id: string,
  lastUsedAt: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE web_sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
    .bind(lastUsedAt, id)
    .run();
}

export async function revokeWebSession(
  db: D1Database,
  id: string,
  revokedAt: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE web_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
    .bind(revokedAt, id)
    .run();
}

export async function revokeUserWebSessions(
  db: D1Database,
  userId: string,
  revokedAt: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE web_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    )
    .bind(revokedAt, userId)
    .run();
}

export async function listWebSessions(
  db: D1Database,
  userId: string,
  now = Date.now(),
): Promise<WebSessionSummary[]> {
  const result = await db
    .prepare(
      `SELECT id, device_label, created_at, last_used_at
       FROM web_sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY last_used_at DESC`,
    )
    .bind(userId, now)
    .all<WebSessionSummary>();
  return result.results;
}

export async function findAccountChallengeById(
  db: D1Database,
  id: string,
  purpose: AccountChallengePurpose,
  userId?: string,
): Promise<AccountChallengeRecord | null> {
  const statement = userId
    ? db
        .prepare(
          `SELECT * FROM account_challenges
           WHERE id = ? AND purpose = ? AND user_id = ?
           LIMIT 1`,
        )
        .bind(id, purpose, userId)
    : db
        .prepare(
          `SELECT * FROM account_challenges
           WHERE id = ? AND purpose = ?
           LIMIT 1`,
        )
        .bind(id, purpose);
  return statement.first<AccountChallengeRecord>();
}

export async function findAccountChallengeByUserAndPurpose(
  db: D1Database,
  userId: string,
  purpose: AccountChallengePurpose,
): Promise<AccountChallengeRecord | null> {
  return db
    .prepare(
      `SELECT * FROM account_challenges
       WHERE user_id = ? AND purpose = ?
       LIMIT 1`,
    )
    .bind(userId, purpose)
    .first<AccountChallengeRecord>();
}

export async function upsertAccountChallenge(
  db: D1Database,
  challenge: AccountChallengeRecord,
): Promise<AccountChallengeRecord | null> {
  await db
    .prepare(
      `INSERT INTO account_challenges
       (id, user_id, purpose, email, code_hash, attempts, last_sent_at, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, purpose) DO UPDATE SET
         email = excluded.email,
         code_hash = excluded.code_hash,
         attempts = excluded.attempts,
         last_sent_at = excluded.last_sent_at,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      challenge.id,
      challenge.user_id,
      challenge.purpose,
      challenge.email,
      challenge.code_hash,
      challenge.attempts,
      challenge.last_sent_at,
      challenge.expires_at,
      challenge.created_at,
      challenge.updated_at,
    )
    .run();
  return findAccountChallengeByUserAndPurpose(
    db,
    challenge.user_id,
    challenge.purpose,
  );
}

export async function updateAccountChallenge(
  db: D1Database,
  challenge: Pick<AccountChallengeRecord, 'id' | 'user_id' | 'purpose'>,
  codeHash: string,
  sentAt: number,
  expiresAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE account_challenges
       SET code_hash = ?, attempts = 0, last_sent_at = ?, expires_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND purpose = ? AND last_sent_at = ?`,
    )
    .bind(
      codeHash,
      sentAt,
      expiresAt,
      sentAt,
      challenge.id,
      challenge.user_id,
      challenge.purpose,
      sentAt,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function claimAccountChallengeResend(
  db: D1Database,
  challenge: Pick<AccountChallengeRecord, 'id' | 'user_id' | 'purpose'>,
  claimedAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE account_challenges
       SET last_sent_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND purpose = ?
         AND expires_at > ? AND last_sent_at <= ?`,
    )
    .bind(
      claimedAt,
      claimedAt,
      challenge.id,
      challenge.user_id,
      challenge.purpose,
      claimedAt,
      claimedAt - ACCOUNT_CHALLENGE_RESEND_DELAY_MS,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function incrementAccountChallengeAttempts(
  db: D1Database,
  challengeId: string,
  purpose: AccountChallengePurpose,
  now: number,
  userId?: string,
): Promise<boolean> {
  const statement = userId
    ? db
        .prepare(
          `UPDATE account_challenges
           SET attempts = attempts + 1, updated_at = ?
           WHERE id = ? AND purpose = ? AND user_id = ?
             AND attempts < ? AND expires_at > ?`,
        )
        .bind(now, challengeId, purpose, userId, ACCOUNT_CHALLENGE_MAX_ATTEMPTS, now)
    : db
        .prepare(
          `UPDATE account_challenges
           SET attempts = attempts + 1, updated_at = ?
           WHERE id = ? AND purpose = ?
             AND attempts < ? AND expires_at > ?`,
        )
        .bind(now, challengeId, purpose, ACCOUNT_CHALLENGE_MAX_ATTEMPTS, now);
  const result = await statement.run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function completePasswordReset(
  db: D1Database,
  challenge: Pick<AccountChallengeRecord, 'id' | 'user_id' | 'purpose'>,
  password: string,
  salt: string,
  updatedAt: number,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE users
         SET password = ?, salt = ?, updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM account_challenges
           WHERE id = ? AND user_id = ? AND purpose = ? AND expires_at > ?
         )`,
      )
      .bind(
        password,
        salt,
        updatedAt,
        challenge.user_id,
        challenge.id,
        challenge.user_id,
        challenge.purpose,
        updatedAt,
      ),
    db
      .prepare(
        `DELETE FROM account_challenges
         WHERE id = ? AND user_id = ? AND purpose = ? AND expires_at > ?`,
      )
      .bind(challenge.id, challenge.user_id, challenge.purpose, updatedAt),
  ]);
  const userUpdate = results[0] as { meta?: { changes?: number } } | undefined;
  return (userUpdate?.meta?.changes ?? 0) > 0;
}

export async function completeEmailChange(
  db: D1Database,
  challenge: Pick<AccountChallengeRecord, 'id' | 'user_id' | 'purpose'>,
  email: string,
  updatedAt: number,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE users
         SET email = ?, email_verified_at = ?, updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM account_challenges
           WHERE id = ? AND user_id = ? AND purpose = ? AND email = ? COLLATE NOCASE
             AND expires_at > ?
         ) AND NOT EXISTS (
           SELECT 1 FROM users existing
           WHERE existing.id <> ? AND existing.email = ? COLLATE NOCASE
         )`,
      )
      .bind(
        email,
        updatedAt,
        updatedAt,
        challenge.user_id,
        challenge.id,
        challenge.user_id,
        challenge.purpose,
        email,
        updatedAt,
        challenge.user_id,
        email,
      ),
    db
      .prepare(
        `DELETE FROM account_challenges
         WHERE id = ? AND user_id = ? AND purpose = ? AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM users WHERE id = ? AND email = ? COLLATE NOCASE
           )`,
      )
      .bind(
        challenge.id,
        challenge.user_id,
        challenge.purpose,
        updatedAt,
        challenge.user_id,
        email,
      ),
  ]);
  const userUpdate = results[0] as { meta?: { changes?: number } } | undefined;
  return (userUpdate?.meta?.changes ?? 0) > 0;
}

export async function findSiteSettings(
  db: D1Database,
): Promise<SiteSettingsRecord | null> {
  return db
    .prepare("SELECT * FROM site_settings WHERE id = 1 LIMIT 1")
    .first<SiteSettingsRecord>();
}

export async function updateSiteSettings(
  db: D1Database,
  settings: RegistrationSettingsValues,
  updatedAt: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE site_settings
       SET registration_mode = ?, max_profiles_per_user = ?, max_textures_per_user = ?, enforce_join_ip = ?, updated_at = ?
       WHERE id = 1`,
    )
    .bind(
      settings.registrationMode,
      settings.maxProfilesPerUser,
      settings.maxTexturesPerUser,
      settings.enforceJoinIp ? 1 : 0,
      updatedAt,
    )
    .run();
}

export async function insertRegistrationInvite(
  db: D1Database,
  invite: RegistrationInviteRecord,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO registration_invites
       (id, code_hash, code_prefix, created_by, use_count, use_limit, expires_at, note, revoked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      invite.id,
      invite.code_hash,
      invite.code_prefix,
      invite.created_by,
      invite.use_count,
      invite.use_limit,
      invite.expires_at,
      invite.note,
      invite.revoked_at,
      invite.created_at,
      invite.updated_at,
    )
    .run();
}

export async function findRegistrationInviteById(
  db: D1Database,
  id: string,
): Promise<RegistrationInviteRecord | null> {
  return db
    .prepare("SELECT * FROM registration_invites WHERE id = ? LIMIT 1")
    .bind(id)
    .first<RegistrationInviteRecord>();
}

export async function findRegistrationInviteByCodeHash(
  db: D1Database,
  codeHash: string,
): Promise<RegistrationInviteRecord | null> {
  return db
    .prepare("SELECT * FROM registration_invites WHERE code_hash = ? LIMIT 1")
    .bind(codeHash)
    .first<RegistrationInviteRecord>();
}

export async function listRegistrationInvites(
  db: D1Database,
  limit = 100,
  offset = 0,
): Promise<RegistrationInviteRecord[]> {
  const result = await db
    .prepare(
      `SELECT * FROM registration_invites
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<RegistrationInviteRecord>();
  return result.results;
}

export async function revokeRegistrationInvite(
  db: D1Database,
  id: string,
  revokedAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE registration_invites
       SET revoked_at = ?, updated_at = ?
       WHERE id = ? AND revoked_at IS NULL`,
    )
    .bind(revokedAt, revokedAt, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function findPendingRegistrationById(
  db: D1Database,
  id: string,
): Promise<PendingRegistrationContext | null> {
  return db
    .prepare(
      `SELECT
        p.id, p.email, p.password_hash, p.salt, p.profile_name, p.invite_id,
        p.created_at, p.updated_at, p.expires_at,
        c.id AS challenge_id, c.code_hash, c.attempts, c.last_sent_at,
        c.expires_at AS challenge_expires_at,
        c.created_at AS challenge_created_at,
        c.updated_at AS challenge_updated_at
       FROM pending_registrations p
       INNER JOIN registration_challenges c ON c.pending_registration_id = p.id
       WHERE p.id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<PendingRegistrationContext>();
}

export async function findPendingRegistrationByEmail(
  db: D1Database,
  email: string,
): Promise<PendingRegistrationContext | null> {
  return db
    .prepare(
      `SELECT
        p.id, p.email, p.password_hash, p.salt, p.profile_name, p.invite_id,
        p.created_at, p.updated_at, p.expires_at,
        c.id AS challenge_id, c.code_hash, c.attempts, c.last_sent_at,
        c.expires_at AS challenge_expires_at,
        c.created_at AS challenge_created_at,
        c.updated_at AS challenge_updated_at
       FROM pending_registrations p
       INNER JOIN registration_challenges c ON c.pending_registration_id = p.id
       WHERE p.email = ? COLLATE NOCASE
       LIMIT 1`,
    )
    .bind(email)
    .first<PendingRegistrationContext>();
}

export async function findPendingRegistrationByName(
  db: D1Database,
  name: string,
): Promise<PendingRegistrationContext | null> {
  return db
    .prepare(
      `SELECT
        p.id, p.email, p.password_hash, p.salt, p.profile_name, p.invite_id,
        p.created_at, p.updated_at, p.expires_at,
        c.id AS challenge_id, c.code_hash, c.attempts, c.last_sent_at,
        c.expires_at AS challenge_expires_at,
        c.created_at AS challenge_created_at,
        c.updated_at AS challenge_updated_at
       FROM pending_registrations p
       INNER JOIN registration_challenges c ON c.pending_registration_id = p.id
       WHERE p.profile_name = ? COLLATE NOCASE
       LIMIT 1`,
    )
    .bind(name)
    .first<PendingRegistrationContext>();
}

export async function insertPendingRegistration(
  db: D1Database,
  pending: PendingRegistrationRecord,
  challenge: RegistrationChallengeRecord,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO pending_registrations
         (id, email, password_hash, salt, profile_name, invite_id, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        pending.id,
        pending.email,
        pending.password_hash,
        pending.salt,
        pending.profile_name,
        pending.invite_id,
        pending.created_at,
        pending.updated_at,
        pending.expires_at,
      ),
    db
      .prepare(
        `INSERT INTO registration_challenges
         (id, pending_registration_id, code_hash, attempts, last_sent_at, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        challenge.id,
        challenge.pending_registration_id,
        challenge.code_hash,
        challenge.attempts,
        challenge.last_sent_at,
        challenge.expires_at,
        challenge.created_at,
        challenge.updated_at,
      ),
  ]);
}

export async function updatePendingRegistration(
  db: D1Database,
  pending: PendingRegistrationRecord,
  challenge: RegistrationChallengeRecord,
  now: number,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE pending_registrations
         SET email = ?, password_hash = ?, salt = ?, profile_name = ?, invite_id = ?,
             updated_at = ?, expires_at = ?
         WHERE id = ? AND expires_at > ?`,
      )
      .bind(
        pending.email,
        pending.password_hash,
        pending.salt,
        pending.profile_name,
        pending.invite_id,
        pending.updated_at,
        pending.expires_at,
        pending.id,
        now,
      ),
    db
      .prepare(
        `UPDATE registration_challenges
         SET code_hash = ?, attempts = 0, last_sent_at = ?, expires_at = ?, updated_at = ?
         WHERE id = ? AND pending_registration_id = ? AND expires_at > ?`,
      )
      .bind(
        challenge.code_hash,
        challenge.last_sent_at,
        challenge.expires_at,
        challenge.updated_at,
        challenge.id,
        challenge.pending_registration_id,
        now,
      ),
  ]);
  const pendingUpdate = results[0] as
    { meta?: { changes?: number } } | undefined;
  const challengeUpdate = results[1] as
    { meta?: { changes?: number } } | undefined;
  return (
    (pendingUpdate?.meta?.changes ?? 0) > 0 &&
    (challengeUpdate?.meta?.changes ?? 0) > 0
  );
}

export async function updateRegistrationChallenge(
  db: D1Database,
  pendingRegistrationId: string,
  challengeId: string,
  codeHash: string,
  sentAt: number,
  expiresAt: number,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE registration_challenges
         SET code_hash = ?, attempts = 0, last_sent_at = ?, expires_at = ?, updated_at = ?
         WHERE id = ? AND pending_registration_id = ?`,
      )
      .bind(
        codeHash,
        sentAt,
        expiresAt,
        sentAt,
        challengeId,
        pendingRegistrationId,
      ),
    db
      .prepare(
        `UPDATE pending_registrations
         SET expires_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(expiresAt, sentAt, pendingRegistrationId),
  ]);
  const challengeUpdate = results[0] as
    { meta?: { changes?: number } } | undefined;
  return (challengeUpdate?.meta?.changes ?? 0) > 0;
}

export async function incrementRegistrationChallengeAttempts(
  db: D1Database,
  challengeId: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE registration_challenges
       SET attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND attempts < 5 AND expires_at > ?`,
    )
    .bind(now, challengeId, now)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function deletePendingRegistration(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM pending_registrations WHERE id = ?")
    .bind(id)
    .run();
}

export async function completePendingRegistration(
  db: D1Database,
  pending: PendingRegistrationRecord,
  user: UserRecord,
  profile: ProfileRecord,
  bootstrapAdmin = false,
): Promise<boolean> {
  const now = Date.now();
  const inviteCondition = pending.invite_id
    ? `EXISTS (
         SELECT 1 FROM registration_invites
         WHERE id = ?
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
           AND use_count < use_limit
       )`
    : "1 = 1";
  const inviteValues = pending.invite_id ? [pending.invite_id, now] : [];

  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO users
         (id, email, password, salt, role, created_at, updated_at, default_profile_id, email_verified_at, status)
         SELECT ?, ?, ?, ?,
           CASE WHEN ? = 1 THEN 'admin' ELSE ? END,
           ?, ?, NULL, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ? COLLATE NOCASE)
           AND NOT EXISTS (SELECT 1 FROM profiles WHERE name = ? COLLATE NOCASE)
           AND ${inviteCondition}`,
      )
      .bind(
        user.id,
        user.email,
        user.password,
        user.salt,
        bootstrapAdmin ? 1 : 0,
        user.role,
        user.created_at,
        user.updated_at,
        user.email_verified_at ?? now,
        user.status ?? "active",
        user.email,
        profile.name,
        ...inviteValues,
      ),
    db
      .prepare(
        `INSERT INTO profiles
         (id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
      )
      .bind(
        profile.id,
        profile.user_id,
        profile.name,
        profile.skin_hash,
        profile.cape_hash,
        profile.skin_model,
        profile.created_at ?? user.created_at,
        profile.updated_at ?? user.updated_at,
        user.id,
      ),
    db
      .prepare(
        `UPDATE users
         SET default_profile_id = ?
         WHERE id = ? AND EXISTS (SELECT 1 FROM profiles WHERE id = ? AND user_id = ?)`,
      )
      .bind(profile.id, user.id, profile.id, user.id),
    db
      .prepare(
        `UPDATE registration_invites
         SET use_count = use_count + 1, updated_at = ?
         WHERE id = ?
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
           AND use_count < use_limit
           AND EXISTS (SELECT 1 FROM users WHERE id = ?)`,
      )
      .bind(now, pending.invite_id, now, user.id),
    db
      .prepare("DELETE FROM pending_registrations WHERE id = ?")
      .bind(pending.id),
  ]);

  const userInsert = results[0] as { meta?: { changes?: number } } | undefined;
  return (userInsert?.meta?.changes ?? 0) > 0;
}

export async function revokeOtherWebSessions(
  db: D1Database,
  userId: string,
  currentSessionId: string,
  revokedAt: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE web_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL",
    )
    .bind(revokedAt, userId, currentSessionId)
    .run();
}

export async function createServerSession(
  db: D1Database,
  session: ServerSessionRecord,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO server_sessions (server_id, profile_id, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (server_id, profile_id) DO UPDATE SET
         user_id = excluded.user_id,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
    )
    .bind(
      session.server_id,
      session.profile_id,
      session.user_id,
      session.created_at,
      session.expires_at,
    )
    .run();
}

export async function findJoinedProfile(
  db: D1Database,
  serverId: string,
  profileName: string,
  now = Date.now(),
): Promise<ProfileRecord | null> {
  return db
    .prepare(
      `SELECT p.*
       FROM server_sessions s
       INNER JOIN profiles p ON p.id = s.profile_id
       WHERE s.server_id = ? AND p.name = ? AND s.expires_at > ?
       LIMIT 1`,
    )
    .bind(serverId, profileName, now)
    .first<ProfileRecord>();
}

export async function updatePassword(
  db: D1Database,
  userId: string,
  password: string,
  salt: string,
  updatedAt: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET password = ?, salt = ?, updated_at = ? WHERE id = ?",
    )
    .bind(password, salt, updatedAt, userId)
    .run();
}

export async function updateProfileAsset(
  db: D1Database,
  profileId: string,
  asset: "skin" | "cape",
  hash: string | null,
  model?: SkinModel,
): Promise<void> {
  if (asset === "skin") {
    await db
      .prepare("UPDATE profiles SET skin_hash = ?, skin_model = ? WHERE id = ?")
      .bind(hash, model ?? "classic", profileId)
      .run();
    return;
  }

  await db
    .prepare("UPDATE profiles SET cape_hash = ? WHERE id = ?")
    .bind(hash, profileId)
    .run();
}

export async function updateProfileAssetIfTextureExists(
  db: D1Database,
  profileId: string,
  userId: string,
  textureId: string,
  asset: TextureType,
  hash: string,
  model?: SkinModel,
): Promise<boolean> {
  const textureExists = `EXISTS (
    SELECT 1 FROM texture_wardrobe
    WHERE id = ? AND user_id = ? AND hash = ? AND texture_type = ?
  )`;
  const statement =
    asset === "skin"
      ? db
          .prepare(
            `UPDATE profiles
         SET skin_hash = ?, skin_model = ?
         WHERE id = ? AND user_id = ? AND ${textureExists}`,
          )
          .bind(
            hash,
            model ?? "classic",
            profileId,
            userId,
            textureId,
            userId,
            hash,
            asset,
          )
      : db
          .prepare(
            `UPDATE profiles
         SET cape_hash = ?
         WHERE id = ? AND user_id = ? AND ${textureExists}`,
          )
          .bind(hash, profileId, userId, textureId, userId, hash, asset);
  const result = await statement.run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function findTextureByIdForUser(
  db: D1Database,
  textureId: string,
  userId: string,
): Promise<TextureWardrobeRecord | null> {
  return db
    .prepare(
      "SELECT * FROM texture_wardrobe WHERE id = ? AND user_id = ? LIMIT 1",
    )
    .bind(textureId, userId)
    .first<TextureWardrobeRecord>();
}

export async function findTextureByUserHashAndType(
  db: D1Database,
  userId: string,
  hash: string,
  textureType: TextureType,
): Promise<TextureWardrobeRecord | null> {
  return db
    .prepare(
      `SELECT * FROM texture_wardrobe
       WHERE user_id = ? AND hash = ? AND texture_type = ?
       LIMIT 1`,
    )
    .bind(userId, hash, textureType)
    .first<TextureWardrobeRecord>();
}

export async function countTexturesByUserId(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM texture_wardrobe WHERE user_id = ?")
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function listTexturesByUserId(
  db: D1Database,
  userId: string,
  textureType: TextureType | null,
  limit: number,
  offset: number,
): Promise<TextureWardrobeRecord[]> {
  const statement = textureType
    ? db
        .prepare(
          `SELECT * FROM texture_wardrobe
         WHERE user_id = ? AND texture_type = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        )
        .bind(userId, textureType, limit, offset)
    : db
        .prepare(
          `SELECT * FROM texture_wardrobe
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        )
        .bind(userId, limit, offset);
  const result = await statement.all<TextureWardrobeRecord>();
  return result.results;
}

export async function countTexturesByUserIdAndType(
  db: D1Database,
  userId: string,
  textureType: TextureType | null,
): Promise<number> {
  const statement = textureType
    ? db
        .prepare(
          "SELECT COUNT(*) AS count FROM texture_wardrobe WHERE user_id = ? AND texture_type = ?",
        )
        .bind(userId, textureType)
    : db
        .prepare(
          "SELECT COUNT(*) AS count FROM texture_wardrobe WHERE user_id = ?",
        )
        .bind(userId);
  const row = await statement.first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function insertTextureBelowLimit(
  db: D1Database,
  texture: TextureWardrobeRecord,
  limit: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO texture_wardrobe
       (id, user_id, hash, texture_type, name, model, width, height, size, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM texture_wardrobe WHERE user_id = ?) < ?
       ON CONFLICT (user_id, hash, texture_type) DO NOTHING`,
    )
    .bind(
      texture.id,
      texture.user_id,
      texture.hash,
      texture.texture_type,
      texture.name,
      texture.model,
      texture.width,
      texture.height,
      texture.size,
      texture.created_at,
      texture.updated_at,
      texture.user_id,
      limit,
    )
    .run();
  return (result.meta?.changes ?? 1) > 0;
}

export async function updateTextureName(
  db: D1Database,
  textureId: string,
  userId: string,
  name: string,
  updatedAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE texture_wardrobe SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .bind(name, updatedAt, textureId, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function deleteTextureIfUnreferenced(
  db: D1Database,
  texture: Pick<
    TextureWardrobeRecord,
    "id" | "user_id" | "hash" | "texture_type"
  >,
): Promise<boolean> {
  const column = texture.texture_type === "skin" ? "skin_hash" : "cape_hash";
  const result = await db
    .prepare(
      `DELETE FROM texture_wardrobe
       WHERE id = ? AND user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM profiles
           WHERE user_id = ? AND ${column} = ?
         )`,
    )
    .bind(texture.id, texture.user_id, texture.user_id, texture.hash)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function listTextureProfileReferences(
  db: D1Database,
  texture: Pick<TextureWardrobeRecord, "user_id" | "hash" | "texture_type">,
): Promise<TextureProfileReference[]> {
  const column = texture.texture_type === "skin" ? "skin_hash" : "cape_hash";
  const result = await db
    .prepare(
      `SELECT id, name FROM profiles
       WHERE user_id = ? AND ${column} = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(texture.user_id, texture.hash)
    .all<{ id: string; name: string }>();
  return result.results.map((profile) => ({
    ...profile,
    asset: texture.texture_type,
  }));
}

export async function countTextureRecordsByHash(
  db: D1Database,
  hash: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM texture_wardrobe WHERE hash = ?")
    .bind(hash)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function updateUserRole(
  db: D1Database,
  userId: string,
  role: UserRole,
  updatedAt: number,
): Promise<void> {
  await db
    .prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
    .bind(role, updatedAt, userId)
    .run();
}

export interface TextureCleanupRow {
  hash: string;
  object_key: string;
  scheduled_at: number;
  attempts: number;
  last_error: string | null;
}

export async function claimTextureCleanup(
  db: D1Database,
  hash: string,
  now: number,
): Promise<TextureCleanupRow | null> {
  return db
    .prepare(
      `SELECT hash, object_key, scheduled_at, attempts, last_error
       FROM texture_cleanup
       WHERE hash = ?
         AND scheduled_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM profiles
           WHERE skin_hash = ? OR cape_hash = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM texture_wardrobe
           WHERE hash = ?
         )
       LIMIT 1`,
    )
    .bind(hash, now, hash, hash, hash)
    .first<TextureCleanupRow>();
}

export async function completeTextureCleanup(
  db: D1Database,
  hash: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM texture_cleanup
       WHERE hash = ?
         AND NOT EXISTS (
           SELECT 1 FROM profiles
           WHERE skin_hash = ? OR cape_hash = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM texture_wardrobe
           WHERE hash = ?
         )`,
    )
    .bind(hash, hash, hash, hash)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function cancelTextureCleanupIfReferenced(
  db: D1Database,
  hash: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM texture_cleanup
       WHERE hash = ?
         AND (
           EXISTS (
             SELECT 1 FROM profiles
             WHERE skin_hash = ? OR cape_hash = ?
           )
           OR EXISTS (
             SELECT 1 FROM texture_wardrobe
             WHERE hash = ?
           )
         )`,
    )
    .bind(hash, hash, hash, hash)
    .run();
}

export async function retryTextureCleanup(
  db: D1Database,
  cleanup: TextureCleanupRow,
  error: string,
  nextScheduledAt: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE texture_cleanup
       SET scheduled_at = ?,
           attempts = attempts + 1,
           last_error = ?
       WHERE hash = ?
         AND scheduled_at = ?`,
    )
    .bind(nextScheduledAt, error, cleanup.hash, cleanup.scheduled_at)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function countAssetReferences(
  db: D1Database,
  hash: string,
): Promise<number> {
  const [profileRow, wardrobeRow] = await Promise.all([
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM profiles WHERE skin_hash = ? OR cape_hash = ?",
      )
      .bind(hash, hash)
      .first<{ count: number }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM texture_wardrobe WHERE hash = ?")
      .bind(hash)
      .first<{ count: number }>(),
  ]);
  return Number(profileRow?.count ?? 0) + Number(wardrobeRow?.count ?? 0);
}

export async function listUsers(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<UserWithProfile[]> {
  const result = await db
    .prepare(
      `SELECT
        u.id, u.email, u.password, u.salt, u.role, u.created_at, u.updated_at,
        p.id AS profile_id, p.name AS profile_name, p.skin_hash, p.cape_hash, p.skin_model
       FROM users u
       INNER JOIN profiles p ON p.id = COALESCE(
         u.default_profile_id,
         (SELECT fallback.id FROM profiles fallback WHERE fallback.user_id = u.id ORDER BY fallback.created_at ASC, fallback.id ASC LIMIT 1)
       )
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<UserWithProfile>();
  return result.results;
}

export function isConstraintViolation(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}
