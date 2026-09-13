import type { ProfileRecord, UserRecord, UserWithProfile } from '../types';

export function serializeProfile(profile: ProfileRecord) {
  return {
    id: profile.id,
    name: profile.name,
    skinHash: profile.skin_hash,
    capeHash: profile.cape_hash,
    skinModel: profile.skin_model,
  };
}

export function serializeUser(user: UserRecord, profile?: ProfileRecord) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    ...(profile ? { profile: serializeProfile(profile) } : {}),
  };
}

export function serializeAdminUser(user: UserRecord, profile?: ProfileRecord) {
  return {
    ...serializeUser(user, profile),
    status: user.status ?? 'active',
    deletionRequestedAt: user.deletion_requested_at ?? null,
  };
}

export function serializeUserWithProfile(user: UserWithProfile) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status ?? 'active',
    deletionRequestedAt: user.deletion_requested_at ?? null,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    profile: {
      id: user.profile_id,
      name: user.profile_name,
      skinHash: user.skin_hash,
      capeHash: user.cape_hash,
      skinModel: user.skin_model,
    },
  };
}
