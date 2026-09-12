export type UserRole = 'user' | 'admin';
export type SkinModel = 'classic' | 'slim';

export interface Bindings {
  DB: D1Database;
  BUCKET: R2Bucket;
  SKIN_DOMAIN?: string;
  API_BASE_URL?: string;
  TOKEN_EXPIRY_HOURS?: string;
  CORS_ORIGIN?: string;
  SERVER_NAME?: string;
  IMPLEMENTATION_VERSION?: string;
  WEB_SESSION_SECRET?: string;
}

export interface Variables {
  user: UserRecord;
  profile: ProfileRecord;
  token?: TokenRecord;
  authMethod: 'bearer' | 'cookie';
  webSession?: WebSessionRecord;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export interface UserRecord {
  id: string;
  email: string;
  password: string;
  salt: string;
  role: UserRole;
  created_at: number;
  updated_at: number;
}

export interface ProfileRecord {
  id: string;
  user_id: string;
  name: string;
  skin_hash: string | null;
  cape_hash: string | null;
  skin_model: SkinModel;
}

export interface TokenRecord {
  access_token: string;
  client_token: string;
  user_id: string;
  profile_id: string;
  created_at: number;
  expires_at: number;
}

export interface WebSessionRecord {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  csrf_token_hash: string;
  device_label: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export interface UserWithProfile extends UserRecord {
  profile_id: string;
  profile_name: string;
  skin_hash: string | null;
  cape_hash: string | null;
  skin_model: SkinModel;
}

export interface YggdrasilProfile {
  id: string;
  name: string;
}

export interface TextureProperty {
  name: 'textures';
  value: string;
  signature?: string;
}
