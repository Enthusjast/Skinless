import type { RegistrationMode } from "./utils/registration";
import type { MailSender } from "./utils/mail";

export type UserRole = "user" | "admin";
export type SkinModel = "classic" | "slim";
export type { RegistrationMode } from "./utils/registration";

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
  RATE_LIMITER: DurableObjectNamespace;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  MAIL_SENDER?: MailSender;
}

export interface Variables {
  user: UserRecord;
  profile: ProfileRecord;
  token?: TokenRecord;
  authMethod: "bearer" | "cookie";
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
  default_profile_id?: string | null;
  email_verified_at?: number | null;
  status?: "active" | "disabled";
}

export interface ProfileRecord {
  id: string;
  user_id: string;
  name: string;
  skin_hash: string | null;
  cape_hash: string | null;
  skin_model: SkinModel;
  created_at?: number;
  updated_at?: number;
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

export interface SiteSettingsRecord {
  id: number;
  registration_mode: RegistrationMode;
  max_profiles_per_user: number;
  max_textures_per_user: number;
  enforce_join_ip: number;
  created_at: number;
  updated_at: number;
}

export interface RegistrationInviteRecord {
  id: string;
  code_hash: string;
  code_prefix: string;
  created_by: string;
  use_count: number;
  use_limit: number;
  expires_at: number | null;
  note: string;
  revoked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PendingRegistrationRecord {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  profile_name: string;
  invite_id: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export interface RegistrationChallengeRecord {
  id: string;
  pending_registration_id: string;
  code_hash: string;
  attempts: number;
  last_sent_at: number;
  expires_at: number;
  created_at: number;
  updated_at: number;
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
  name: "textures";
  value: string;
  signature?: string;
}
