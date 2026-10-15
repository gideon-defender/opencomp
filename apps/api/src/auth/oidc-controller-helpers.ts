import type { Request } from 'express';
import { getSessionCookieNames, unsignedSessionToken } from './session-cookie';

// Compose/env-file loaders can preserve surrounding quotes, unlike dotenv.
// Strip them to prevent redirects becoming malformed relative URLs.
export function stripSurroundingQuotes(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim() || undefined;
  }
  return trimmed || undefined;
}

/**
 * Reconstruct the externally visible callback URL. Chained proxies join
 * `x-forwarded-proto` with commas — only the first (client-facing) value
 * is ours.
 */
export function buildCallbackUrl(req: Request): string {
  const forwarded = req.headers['x-forwarded-proto'];
  const first = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : undefined;
  const proto = (first ?? req.protocol).trim() || req.protocol;
  return `${proto}://${req.get('host')}${req.originalUrl}`;
}

/**
 * Session token from the session cookie (secure-prefixed variant first,
 * mirroring better-auth's read order) or a bearer session token. Cookie
 * values arrive signed (`token.signature`, URI-encoded on the wire) and the
 * Session row is keyed by the raw token, so the signature is stripped here.
 */
export function extractSessionToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  for (const name of getSessionCookieNames()) {
    const token = unsignedSessionToken(cookies[name]);
    if (token) return token;
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return unsignedSessionToken(authHeader.slice(7).trim());
  }
  return null;
}

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && out[name] === undefined) out[name] = value;
  }
  return out;
}
