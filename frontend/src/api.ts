const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
// An empty base URL intentionally keeps browser requests on the current origin.
export const API_BASE_URL = configuredBaseUrl.replace(/\/+$/, '');
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim();

export interface ApiProfile {
  id: string;
  name: string;
  skinHash: string | null;
  capeHash: string | null;
  skinModel: 'classic' | 'slim';
}

export interface ProfileCollection {
  profiles: ApiProfile[];
  defaultProfileId: string | null;
}

export type WardrobeTextureType = 'skin' | 'cape';
export type WardrobeTextureModel = 'classic' | 'slim' | null;

export interface WardrobeTexture {
  id: string;
  hash: string;
  type: WardrobeTextureType;
  name: string;
  model: WardrobeTextureModel;
  width: number | null;
  height: number | null;
  size: number | null;
  createdAt: number;
  updatedAt: number;
  previewUrl: string;
}

export interface WardrobeQuota {
  used: number;
  limit: number;
}

export interface WardrobeResponse {
  textures: WardrobeTexture[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  quota: WardrobeQuota;
}

export interface ApiUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: number;
  updatedAt: number;
  profile: ApiProfile;
}

export interface AuthResponse {
  accessToken: string;
  clientToken: string;
  availableProfiles: Array<{ id: string; name: string }>;
  selectedProfile: { id: string; name: string };
}

export interface WebAuthResponse extends ProfileCollection {
  user: ApiUser;
  csrfToken: string;
}

export interface RegistrationStartResponse {
  challengeId: string;
  expiresAt: number;
  resendAfter: number;
}

export interface RegistrationVerifyResponse {
  user: ApiUser;
}

export interface PasswordResetStartResponse {
  message: string;
  challengeId: string;
  expiresAt: number;
  resendAfter: number;
}

export interface EmailChangeChallengeResponse {
  challengeId: string;
  email: string;
  expiresAt: number;
  resendAfter: number;
}

export interface WebSession {
  id: string;
  deviceLabel: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

export type AdminUser = ApiUser;

export type RegistrationMode = 'open' | 'invite' | 'closed';

export interface AdminRegistrationSettings {
  registrationMode: RegistrationMode;
  maxProfilesPerUser: number;
  maxTexturesPerUser: number;
  enforceJoinIp: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AdminInvite {
  id: string;
  code?: string;
  codePrefix: string;
  createdBy: string;
  useCount: number;
  useLimit: number;
  expiresAt: number | null;
  note: string;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function redactCredentialText(message: string): string {
  return message
    .replace(/Bearer\s+[^\s]+/gi, '登录凭证')
    .replace(/\b(?:access|refresh|client|csrf)[_-]?token\s*[:=]\s*[^\s,]+/gi, '凭证');
}

export function formatApiError(cause: unknown, fallback: string): string {
  if (!(cause instanceof ApiError)) {
    return cause instanceof Error ? redactCredentialText(cause.message) : fallback;
  }

  const messages: Record<string, string> = {
    Unauthorized: '登录状态已失效，请重新登录。',
    unauthorized: '登录状态已失效，请重新登录。',
    Forbidden: '没有权限完成此操作。',
    TooManyRequests: '尝试次数过多，请稍后再试。',
  };
  return messages[cause.code ?? ''] ?? redactCredentialText(cause.message);
}

let csrfToken: string | null = null;
let refreshPromise: Promise<WebAuthResponse> | null = null;

export function setCsrfToken(value: string | null): void {
  csrfToken = value?.trim() || null;
}

export function clearCsrfToken(): void {
  setCsrfToken(null);
}

function url(path: string): string {
  return `${API_BASE_URL}${path}`;
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split('; ')
    .find((part) => part.startsWith('skinless_csrf='))
    ?.slice('skinless_csrf='.length);
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie) || null;
  } catch {
    return cookie || null;
  }
}

function currentCsrfToken(): string | null {
  return csrfToken ?? readCsrfCookie();
}

function prepareHeaders(init: RequestInit, includeCsrf: boolean): Headers {
  const headers = new Headers(init.headers);
  if (includeCsrf) headers.delete('Authorization');
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (includeCsrf && !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase())) {
    const token = currentCsrfToken();
    if (token) headers.set('X-CSRF-Token', token);
  }
  return headers;
}

function errorFromBody(response: Response, body: unknown): ApiError {
  const message =
    typeof body === 'object' &&
    body !== null &&
    'errorMessage' in body &&
    typeof body.errorMessage === 'string'
      ? body.errorMessage
      : `Request failed with status ${response.status}.`;
  const code =
    typeof body === 'object' &&
    body !== null &&
    'errorCode' in body &&
    typeof body.errorCode === 'string'
      ? body.errorCode
      : undefined;
  return new ApiError(response.status, message, code);
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw errorFromBody(response, body);
  return body as T;
}

function captureCsrfToken(body: unknown): void {
  if (
    typeof body === 'object' &&
    body !== null &&
    'csrfToken' in body &&
    typeof body.csrfToken === 'string'
  ) {
    setCsrfToken(body.csrfToken);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url(path), {
    ...init,
    headers: prepareHeaders(init, false),
  });
  return parseResponse<T>(response);
}

function canRefreshFor(path: string): boolean {
  return path !== '/api/auth/refresh' && path !== '/api/auth/login' && path !== '/api/register';
}

async function managementRequest<T>(
  path: string,
  init: RequestInit = {},
  retryAfterRefresh = true,
): Promise<T> {
  const response = await fetch(url(path), {
    ...init,
    credentials: 'same-origin',
    headers: prepareHeaders(init, true),
  });

  if (response.status === 401 && retryAfterRefresh && canRefreshFor(path)) {
    try {
      await refreshSession();
    } catch {
      return parseResponse<T>(response);
    }
    return managementRequest<T>(path, init, false);
  }

  const body = await parseResponse<T>(response);
  captureCsrfToken(body);
  return body;
}

export function authenticate(
  email: string,
  password: string,
  clientToken: string,
): Promise<AuthResponse> {
  return request<AuthResponse>('/authserver/authenticate', {
    method: 'POST',
    body: JSON.stringify({ username: email, password, clientToken, requestUser: true }),
  });
}

export function invalidate(accessToken: string, clientToken: string): Promise<void> {
  return request<void>('/authserver/invalidate', {
    method: 'POST',
    body: JSON.stringify({ accessToken, clientToken }),
  });
}

export function startRegistration(
  email: string,
  password: string,
  name: string,
  inviteCode?: string,
  turnstileToken?: string,
): Promise<RegistrationStartResponse> {
  const body: {
    email: string;
    password: string;
    name: string;
    inviteCode?: string;
    turnstileToken?: string;
  } = { email, password, name };
  if (inviteCode?.trim()) body.inviteCode = inviteCode.trim();
  if (turnstileToken?.trim()) body.turnstileToken = turnstileToken.trim();
  return request<RegistrationStartResponse>('/api/auth/register/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function register(
  email: string,
  password: string,
  name: string,
): Promise<RegistrationStartResponse> {
  return startRegistration(email, password, name);
}

export function verifyRegistration(
  challengeId: string,
  code: string,
): Promise<RegistrationVerifyResponse> {
  return request<RegistrationVerifyResponse>('/api/auth/register/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, code }),
  });
}

export function resendRegistration(challengeId: string): Promise<RegistrationStartResponse> {
  return request<RegistrationStartResponse>('/api/auth/register/resend', {
    method: 'POST',
    body: JSON.stringify({ challengeId }),
  });
}

export function startPasswordReset(
  email: string,
  turnstileToken?: string,
): Promise<PasswordResetStartResponse> {
  const body: { email: string; turnstileToken?: string } = { email };
  if (turnstileToken?.trim()) body.turnstileToken = turnstileToken.trim();
  return request<PasswordResetStartResponse>('/api/auth/password/reset/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function resendPasswordReset(
  challengeId: string,
  turnstileToken?: string,
): Promise<PasswordResetStartResponse> {
  const body: { challengeId: string; turnstileToken?: string } = { challengeId };
  if (turnstileToken?.trim()) body.turnstileToken = turnstileToken.trim();
  return request<PasswordResetStartResponse>('/api/auth/password/reset/resend', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function verifyPasswordReset(
  challengeId: string,
  code: string,
  newPassword: string,
): Promise<void> {
  return request<void>('/api/auth/password/reset/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, code, newPassword }),
  });
}

export function login(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<WebAuthResponse> {
  const body: { email: string; password: string; turnstileToken?: string } = { email, password };
  if (turnstileToken?.trim()) body.turnstileToken = turnstileToken.trim();
  return managementRequest<WebAuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function refreshSession(): Promise<WebAuthResponse> {
  if (refreshPromise) return refreshPromise;

  const requestPromise = managementRequest<WebAuthResponse>(
    '/api/auth/refresh',
    { method: 'POST' },
    false,
  );
  refreshPromise = requestPromise.finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export function logout(): Promise<void> {
  return managementRequest<void>('/api/auth/logout', { method: 'POST' }).finally(clearCsrfToken);
}

export function getUserProfile(): Promise<{ user: ApiUser } & ProfileCollection> {
  return managementRequest<{ user: ApiUser } & ProfileCollection>('/api/user/profile');
}

export function getProfiles(): Promise<ProfileCollection> {
  return managementRequest<ProfileCollection>('/api/user/profiles');
}

export function createProfile(name: string): Promise<{ profile: ApiProfile } & ProfileCollection> {
  return managementRequest<{ profile: ApiProfile } & ProfileCollection>('/api/user/profiles', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function renameProfile(
  profileId: string,
  name: string,
): Promise<{ profile: ApiProfile } & ProfileCollection> {
  return managementRequest<{ profile: ApiProfile } & ProfileCollection>(
    `/api/user/profiles/${encodeURIComponent(profileId)}`,
    { method: 'PATCH', body: JSON.stringify({ name }) },
  );
}

export function deleteProfile(profileId: string): Promise<void> {
  return managementRequest<void>(`/api/user/profiles/${encodeURIComponent(profileId)}`, {
    method: 'DELETE',
  });
}

export function setDefaultProfile(
  profileId: string,
): Promise<{ user: ApiUser } & ProfileCollection> {
  return managementRequest<{ user: ApiUser } & ProfileCollection>(
    `/api/user/profiles/${encodeURIComponent(profileId)}/default`,
    { method: 'PUT' },
  );
}

export function getWardrobe(
  options: {
    type?: WardrobeTextureType;
    limit?: number;
    offset?: number;
  } = {},
): Promise<WardrobeResponse> {
  const params = new URLSearchParams();
  if (options.type) params.set('type', options.type);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  const query = params.toString();
  return managementRequest<WardrobeResponse>(`/api/user/wardrobe${query ? `?${query}` : ''}`);
}

export function uploadWardrobeTexture(
  type: WardrobeTextureType,
  file: Blob,
  name: string,
  model: Exclude<WardrobeTextureModel, null> = 'classic',
): Promise<{ texture: WardrobeTexture; quota: WardrobeQuota; reused: boolean }> {
  const form = new FormData();
  form.set('file', file, `${type}.png`);
  form.set('type', type);
  form.set('name', name);
  if (type === 'skin') form.set('model', model);
  return managementRequest<{ texture: WardrobeTexture; quota: WardrobeQuota; reused: boolean }>(
    '/api/user/wardrobe',
    { method: 'POST', body: form },
  );
}

export function renameWardrobeTexture(
  textureId: string,
  name: string,
): Promise<{ texture: WardrobeTexture }> {
  return managementRequest<{ texture: WardrobeTexture }>(
    `/api/user/wardrobe/${encodeURIComponent(textureId)}`,
    { method: 'PATCH', body: JSON.stringify({ name }) },
  );
}

export function deleteWardrobeTexture(textureId: string): Promise<void> {
  return managementRequest<void>(`/api/user/wardrobe/${encodeURIComponent(textureId)}`, {
    method: 'DELETE',
  });
}

export function applyWardrobeTexture(
  textureId: string,
  profileId: string,
): Promise<{ texture: WardrobeTexture; profile: ApiProfile }> {
  return managementRequest<{ texture: WardrobeTexture; profile: ApiProfile }>(
    `/api/user/wardrobe/${encodeURIComponent(textureId)}/apply`,
    { method: 'POST', body: JSON.stringify({ profileId }) },
  );
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return managementRequest<void>('/api/user/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function startEmailChange(
  currentPassword: string,
  newEmail: string,
  turnstileToken?: string,
): Promise<EmailChangeChallengeResponse> {
  const body: { currentPassword: string; newEmail: string; turnstileToken?: string } = {
    currentPassword,
    newEmail,
  };
  if (turnstileToken?.trim()) body.turnstileToken = turnstileToken.trim();
  return managementRequest<EmailChangeChallengeResponse>('/api/user/email/change/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function resendEmailChange(
  challengeId: string,
  turnstileToken?: string,
): Promise<EmailChangeChallengeResponse> {
  const body: { challengeId: string; turnstileToken?: string } = { challengeId };
  if (turnstileToken?.trim()) body.turnstileToken = turnstileToken.trim();
  return managementRequest<EmailChangeChallengeResponse>('/api/user/email/change/resend', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function completeEmailChange(
  challengeId: string,
  code: string,
  currentPassword?: string,
): Promise<{ user: ApiUser }> {
  return managementRequest<{ user: ApiUser }>('/api/user/email', {
    method: 'PUT',
    body: JSON.stringify({
      challengeId,
      code,
      ...(currentPassword ? { currentPassword } : {}),
    }),
  });
}

export function uploadAsset(
  asset: 'skin' | 'cape',
  file: Blob,
  model: 'classic' | 'slim',
  clientHash?: string,
): Promise<{ hash: string; profile: ApiProfile }> {
  const form = new FormData();
  form.set('file', file, `${asset}.png`);
  if (asset === 'skin') form.set('skin_model', model);
  if (clientHash) form.set('sha256', clientHash);
  return managementRequest<{ hash: string; profile: ApiProfile }>(`/api/user/${asset}`, {
    method: 'POST',
    body: form,
  });
}

export function deleteAsset(asset: 'skin' | 'cape'): Promise<void> {
  return managementRequest<void>(`/api/user/${asset}`, { method: 'DELETE' });
}

export function getSessions(): Promise<{ sessions: WebSession[] }> {
  return managementRequest<{ sessions: WebSession[] }>('/api/auth/sessions');
}

export function revokeSession(sessionId: string): Promise<void> {
  return managementRequest<void>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export function revokeOtherSessions(): Promise<void> {
  return managementRequest<void>('/api/auth/sessions?scope=other', { method: 'DELETE' });
}

export function getAdminUsers(): Promise<{ users: AdminUser[] }> {
  return managementRequest<{ users: AdminUser[] }>('/api/admin/users');
}

export function updateUserRole(userId: string, role: 'user' | 'admin'): Promise<void> {
  return managementRequest<void>(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export function getAdminSettings(): Promise<{ settings: AdminRegistrationSettings }> {
  return managementRequest<{ settings: AdminRegistrationSettings }>('/api/admin/settings');
}

export function updateAdminSettings(
  settings: Pick<
    AdminRegistrationSettings,
    'registrationMode' | 'maxProfilesPerUser' | 'maxTexturesPerUser' | 'enforceJoinIp'
  >,
): Promise<{ settings: AdminRegistrationSettings }> {
  return managementRequest<{ settings: AdminRegistrationSettings }>('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

export function getAdminInvites(): Promise<{ invites: AdminInvite[] }> {
  return managementRequest<{ invites: AdminInvite[] }>('/api/admin/invites');
}

export function createAdminInvite(input: {
  useLimit: number;
  expiresAt: number | null;
  note: string;
}): Promise<{ invite: AdminInvite & { code: string } }> {
  return managementRequest<{ invite: AdminInvite & { code: string } }>('/api/admin/invites', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revokeAdminInvite(inviteId: string): Promise<{ invite: AdminInvite }> {
  return managementRequest<{ invite: AdminInvite }>(
    `/api/admin/invites/${encodeURIComponent(inviteId)}/revoke`,
    { method: 'POST' },
  );
}
