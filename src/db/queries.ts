import type {
  ProfileRecord,
  TokenRecord,
  UserRecord,
  UserRole,
  UserWithProfile,
  SkinModel,
} from '../types';

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

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRecord | null> {
  return db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').bind(email).first<UserRecord>();
}

export async function findUserById(db: D1Database, id: string): Promise<UserRecord | null> {
  return db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(id).first<UserRecord>();
}

export async function findProfileByUserId(db: D1Database, userId: string): Promise<ProfileRecord | null> {
  return db.prepare('SELECT * FROM profiles WHERE user_id = ? LIMIT 1').bind(userId).first<ProfileRecord>();
}

export async function findProfileById(db: D1Database, profileId: string): Promise<ProfileRecord | null> {
  return db.prepare('SELECT * FROM profiles WHERE id = ? LIMIT 1').bind(profileId).first<ProfileRecord>();
}

export async function findProfileByName(db: D1Database, name: string): Promise<ProfileRecord | null> {
  return db.prepare('SELECT * FROM profiles WHERE name = ? LIMIT 1').bind(name).first<ProfileRecord>();
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
        `INSERT INTO users (id, email, password, salt, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(user.id, user.email, user.password, user.salt, user.role, user.created_at, user.updated_at),
    db
      .prepare(
        `INSERT INTO profiles (id, user_id, name, skin_hash, cape_hash, skin_model)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(profile.id, profile.user_id, profile.name, profile.skin_hash, profile.cape_hash, profile.skin_model),
  ]);
}

export async function insertToken(db: D1Database, token: TokenRecord): Promise<void> {
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

export async function rotateToken(db: D1Database, previous: string, token: TokenRecord): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM tokens WHERE access_token = ?').bind(previous),
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

export async function deleteToken(db: D1Database, accessToken: string): Promise<void> {
  await db.prepare('DELETE FROM tokens WHERE access_token = ?').bind(accessToken).run();
}

export async function deleteUserTokens(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM tokens WHERE user_id = ?').bind(userId).run();
}

export async function updatePassword(
  db: D1Database,
  userId: string,
  password: string,
  salt: string,
  updatedAt: number,
): Promise<void> {
  await db
    .prepare('UPDATE users SET password = ?, salt = ?, updated_at = ? WHERE id = ?')
    .bind(password, salt, updatedAt, userId)
    .run();
}

export async function updateProfileAsset(
  db: D1Database,
  profileId: string,
  asset: 'skin' | 'cape',
  hash: string | null,
  model?: SkinModel,
): Promise<void> {
  if (asset === 'skin') {
    await db
      .prepare('UPDATE profiles SET skin_hash = ?, skin_model = ? WHERE id = ?')
      .bind(hash, model ?? 'classic', profileId)
      .run();
    return;
  }

  await db.prepare('UPDATE profiles SET cape_hash = ? WHERE id = ?').bind(hash, profileId).run();
}

export async function updateUserRole(db: D1Database, userId: string, role: UserRole, updatedAt: number): Promise<void> {
  await db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').bind(role, updatedAt, userId).run();
}

export async function countAssetReferences(db: D1Database, hash: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM profiles WHERE skin_hash = ? OR cape_hash = ?')
    .bind(hash, hash)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function listUsers(db: D1Database, limit: number, offset: number): Promise<UserWithProfile[]> {
  const result = await db
    .prepare(
      `SELECT
        u.id, u.email, u.password, u.salt, u.role, u.created_at, u.updated_at,
        p.id AS profile_id, p.name AS profile_name, p.skin_hash, p.cape_hash, p.skin_model
       FROM users u
       INNER JOIN profiles p ON p.user_id = u.id
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
