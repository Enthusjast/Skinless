const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
// An empty base URL intentionally keeps browser requests on the current origin.
export const API_BASE_URL = configuredBaseUrl.replace(/\/+$/, '');

export interface ApiProfile {
  id: string;
  name: string;
  skinHash: string | null;
  capeHash: string | null;
  skinModel: 'classic' | 'slim';
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
  selectedProfile: { id: string; name: string };
}

export interface WebAuthResponse {
  user: ApiUser;
  csrfToken: string;
}

export interface WebSession {
  id: string;
  deviceLabel: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

export type AdminUser = ApiUser;

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

export function register(
  email: string,
  password: string,
  name: string,
): Promise<{ user: ApiUser }> {
  return managementRequest<{ user: ApiUser }>('/api/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export function login(email: string, password: string): Promise<WebAuthResponse> {
  return managementRequest<WebAuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function refreshSession(): Promise<WebAuthResponse> {
  return managementRequest<WebAuthResponse>('/api/auth/refresh', { method: 'POST' }, false);
}

export function logout(): Promise<void> {
  return managementRequest<void>('/api/auth/logout', { method: 'POST' }).finally(clearCsrfToken);
}

export function getUserProfile(): Promise<{ user: ApiUser }> {
  return managementRequest<{ user: ApiUser }>('/api/user/profile');
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return managementRequest<void>('/api/user/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
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
