import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { sha256Hex, signHmac, verifyHmac } from './crypto';

export const ACCESS_COOKIE_NAME = '__Host-skinless_access';
export const REFRESH_COOKIE_NAME = '__Host-skinless_refresh';
export const CSRF_COOKIE_NAME = 'skinless_csrf';
export const ACCESS_COOKIE_MAX_AGE = 15 * 60;
export const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
export const WEB_SESSION_TTL_MS = REFRESH_COOKIE_MAX_AGE * 1000;
export const ACCESS_TOKEN_TTL_MS = ACCESS_COOKIE_MAX_AGE * 1000;

export interface AccessCookiePayload {
  sessionId: string;
  userId: string;
  expiresAt: number;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function createOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createAccessCookieValue(payload: AccessCookiePayload, secret: string): Promise<string> {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${await signHmac(encodedPayload, secret)}`;
}

export async function verifyAccessCookieValue(
  value: string,
  secret: string,
  now = Date.now(),
): Promise<AccessCookiePayload | null> {
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!await verifyHmac(parts[0], parts[1], secret)) return null;
  const decoded = decodeBase64Url(parts[0]);
  if (!decoded) return null;

  try {
    const payload = JSON.parse(decoded) as Partial<AccessCookiePayload>;
    if (
      typeof payload.sessionId !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.expiresAt !== 'number' ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= now
    ) return null;
    return payload as AccessCookiePayload;
  } catch {
    return null;
  }
}

export function parseRefreshCookie(value: string | undefined): { sessionId: string; secret: string } | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { sessionId: parts[0], secret: parts[1] };
}

export async function hashSessionToken(value: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(value));
}

export function deviceLabelFromUserAgent(userAgent: string | undefined): string {
  const value = userAgent ?? '';
  const browser = /Edg\//.test(value)
    ? 'Edge'
    : /OPR\//.test(value)
      ? 'Opera'
      : /Firefox\//.test(value)
        ? 'Firefox'
        : /Chrome\//.test(value)
          ? 'Chrome'
          : /Safari\//.test(value)
            ? 'Safari'
            : 'Unknown browser';
  const platform = /iPhone|iPad|iPod/.test(value)
    ? 'iOS'
    : /Android/.test(value)
      ? 'Android'
      : /Windows NT/.test(value)
        ? 'Windows'
        : /Mac OS X/.test(value)
          ? 'macOS'
          : /Linux/.test(value)
            ? 'Linux'
            : 'Unknown device';
  return `${browser} on ${platform}`.slice(0, 64);
}

function setAuthCookie(c: Context, name: string, value: string, maxAge: number, httpOnly: boolean): void {
  setCookie(c, name, value, {
    maxAge,
    path: '/',
    secure: true,
    httpOnly,
    sameSite: 'Strict',
  });
}

export function setWebSessionCookies(
  c: Context,
  accessValue: string,
  refreshValue: string,
  csrfToken: string,
): void {
  setAuthCookie(c, ACCESS_COOKIE_NAME, accessValue, ACCESS_COOKIE_MAX_AGE, true);
  setAuthCookie(c, REFRESH_COOKIE_NAME, refreshValue, REFRESH_COOKIE_MAX_AGE, true);
  setAuthCookie(c, CSRF_COOKIE_NAME, csrfToken, REFRESH_COOKIE_MAX_AGE, false);
}

export function clearWebSessionCookies(c: Context): void {
  setAuthCookie(c, ACCESS_COOKIE_NAME, '', 0, true);
  setAuthCookie(c, REFRESH_COOKIE_NAME, '', 0, true);
  setAuthCookie(c, CSRF_COOKIE_NAME, '', 0, false);
}

export function getAccessCookie(c: Context): string | undefined {
  return getCookie(c, ACCESS_COOKIE_NAME);
}

export function getRefreshCookie(c: Context): string | undefined {
  return getCookie(c, REFRESH_COOKIE_NAME);
}
