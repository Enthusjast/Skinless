import type { Context } from 'hono';
import type { AppEnv } from '../types';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function cleanDomain(value: string): string {
  return value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export function getPublicBaseUrl(c: Context<AppEnv>): string {
  const configured = c.env.API_BASE_URL?.trim();
  if (configured) return trimTrailingSlash(configured);
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

export function getTokenExpiryMs(c: Context<AppEnv>): number {
  const hours = Number(c.env.TOKEN_EXPIRY_HOURS ?? '24');
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

export function metadata(c: Context<AppEnv>): Response {
  return c.json({
    meta: {
      serverName: c.env.SERVER_NAME ?? 'Skinless',
      implementationName: 'cf-yggdrasil',
      implementationVersion: c.env.IMPLEMENTATION_VERSION ?? '0.1.0',
    },
    skinDomains: getSkinDomains(c),
  });
}
