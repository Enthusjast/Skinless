import type { Context } from 'hono';
import type { AppEnv, Bindings } from '../types';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function cleanDomain(value: string): string {
  return value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export function getPublicBaseUrl(c: Context<AppEnv>): string {
  const configured = c.env.API_BASE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      url.username = '';
      url.password = '';
      return trimTrailingSlash(url.toString());
    } catch {
      return trimTrailingSlash(configured);
    }
  }
  return new URL(c.req.url).origin;
}

export function getSkinDomains(c: Context<AppEnv>): string[] {
  const configured = c.env.SKIN_DOMAIN?.split(',').map(cleanDomain).filter(Boolean) ?? [];
  if (configured.length > 0) return configured;
  return [new URL(c.req.url).host];
}

export function getTextureUrl(c: Context<AppEnv>, hash: string): string {
  return `${getPublicBaseUrl(c)}/textures/${hash}`;
}

export function isSameOrigin(c: Context<AppEnv>): boolean {
  const configured = c.env.API_BASE_URL?.trim();
  if (!configured) return true;

  try {
    const configuredOrigin = new URL(configured).origin;
    const requestOrigin = c.req.header('Origin')?.trim() || new URL(c.req.url).origin;
    return new URL(requestOrigin).origin === configuredOrigin;
  } catch {
    return false;
  }
}

export function getYggdrasilPrivateKeyPem(bindings: Bindings): string | null {
  const key = (bindings.YGGDRASIL_PRIVATE_KEY_PEM ?? bindings.YGGDRASIL_PRIVATE_KEY)?.trim();
  return key || null;
}

export function getYggdrasilPublicKeyPem(bindings: Bindings): string | null {
  const key = (bindings.YGGDRASIL_PUBLIC_KEY_PEM ?? bindings.YGGDRASIL_PUBLIC_KEY)?.trim();
  return key || null;
}

export function allowUnsignedTextures(bindings: Bindings): boolean {
  const environment = bindings.ENVIRONMENT?.trim().toLowerCase();
  const explicitlyEnabled = bindings.YGGDRASIL_ALLOW_UNSIGNED_TEXTURES?.trim().toLowerCase() === 'true';
  return explicitlyEnabled && (environment === 'development' || environment === 'local' || environment === 'test');
}

export function getTokenExpiryMs(c: Context<AppEnv>): number {
  const hours = Number(c.env.TOKEN_EXPIRY_HOURS ?? '24');
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

export function metadata(c: Context<AppEnv>): Response {
  const publicKey = getYggdrasilPublicKeyPem(c.env);
  return c.json({
    meta: {
      serverName: c.env.SERVER_NAME ?? 'Skinless',
      implementationName: 'cf-yggdrasil',
      implementationVersion: c.env.IMPLEMENTATION_VERSION ?? '0.1.0',
    },
    skinDomains: getSkinDomains(c),
    ...(publicKey ? { signaturePublickey: publicKey } : {}),
  });
}

export function publicKeys(c: Context<AppEnv>): Response {
  return c.json({ yggdrasil: getYggdrasilPublicKeyPem(c.env) ?? '' });
}
