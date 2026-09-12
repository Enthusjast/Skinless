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

function url(path: string): string {
  return `${API_BASE_URL}${path}`;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url(path), { ...init, headers });
  if (response.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
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
    throw new ApiError(response.status, message, code);
  }
  return body as T;
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
  return request<{ user: ApiUser }>('/api/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export function getUserProfile(token: string): Promise<{ user: ApiUser }> {
  return request<{ user: ApiUser }>('/api/user/profile', {}, token);
}

export function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return request<void>(
    '/api/user/password',
    {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    },
    token,
  );
}

export function uploadAsset(
  token: string,
  asset: 'skin' | 'cape',
  file: Blob,
  model: 'classic' | 'slim',
  clientHash?: string,
): Promise<{ hash: string; profile: ApiProfile }> {
  const form = new FormData();
  form.set('file', file, `${asset}.png`);
  if (asset === 'skin') form.set('skin_model', model);
  if (clientHash) form.set('sha256', clientHash);
  return request<{ hash: string; profile: ApiProfile }>(
    `/api/user/${asset}`,
    { method: 'POST', body: form },
    token,
  );
}

export function deleteAsset(token: string, asset: 'skin' | 'cape'): Promise<void> {
  return request<void>(`/api/user/${asset}`, { method: 'DELETE' }, token);
}

export function getAdminUsers(token: string): Promise<{ users: AdminUser[] }> {
  return request<{ users: AdminUser[] }>('/api/admin/users', {}, token);
}

export function updateUserRole(
  token: string,
  userId: string,
  role: 'user' | 'admin',
): Promise<void> {
  return request<void>(
    `/api/admin/users/${encodeURIComponent(userId)}/role`,
    {
      method: 'PUT',
      body: JSON.stringify({ role }),
    },
    token,
  );
}
