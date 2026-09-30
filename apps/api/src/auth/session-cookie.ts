import { createHmac } from 'node:crypto';
import type { Response } from 'express';

/** Session lifetime mirroring better-auth's default (7 days). */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Determine the cookie domain based on environment.
 *
 * Hostname-exact matching (CodeQL js/incomplete-url-substring-sanitization):
 * substring checks would match crafted URLs like
 * "https://staging.gideondefender.com.evil.com".
 */
export function getCookieDomain(): string | undefined {
  const baseUrl = process.env.BASE_URL || '';

  try {
    const { hostname } = new URL(baseUrl);
    if (
      hostname === 'staging.gideondefender.com' ||
      hostname.endsWith('.staging.gideondefender.com')
    ) {
      return '.staging.gideondefender.com';
    }
    if (
      hostname === 'dev.gideondefender.com' ||
      hostname.endsWith('.dev.gideondefender.com')
    ) {
      return '.dev.gideondefender.com';
    }
    if (
      hostname === 'gideondefender.com' ||
      hostname.endsWith('.gideondefender.com')
    ) {
      return '.gideondefender.com';
    }
  } catch {
    // Unparseable BASE_URL — no cookie domain (host-only cookies).
  }
  return undefined;
}

/** better-auth `__Secure-` prefix for cookies set in secure contexts. */
export const SECURE_COOKIE_PREFIX = '__Secure-';

/**
 * Whether session cookies are set with the `Secure` attribute + `__Secure-`
 * name prefix. Mirrors better-auth's `useSecureCookies` resolution: explicit
 * https `BASE_URL`, otherwise production. Local plain-HTTP dev stays plain
 * so the cookie is still sent back by the browser.
 */
export function shouldUseSecureCookies(): boolean {
  const baseUrl = process.env.BASE_URL || '';
  try {
    const url = new URL(baseUrl);
    if (url.protocol === 'https:') return true;
    if (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '::1')
    ) {
      return false;
    }
  } catch {
    // Unparseable BASE_URL — fall through to the environment check.
  }
  return process.env.NODE_ENV === 'production';
}

/**
 * Session cookie name mirroring better-auth's `advanced.cookiePrefix` config
 * in `auth.server.ts` plus its secure-context `__Secure-` prefix:
 * production keeps the default `better-auth` prefix, staging uses `staging`,
 * the `dev.gideondefender.com` env uses `dev`, local/other uses `local`.
 */
export function getSessionCookieName(): string {
  const baseUrl = process.env.BASE_URL || '';
  let prefix = 'local';
  try {
    const { hostname } = new URL(baseUrl);
    if (
      hostname === 'staging.gideondefender.com' ||
      hostname.endsWith('.staging.gideondefender.com')
    ) {
      prefix = 'staging';
    } else if (
      hostname === 'dev.gideondefender.com' ||
      hostname.endsWith('.dev.gideondefender.com')
    ) {
      prefix = 'dev';
    } else if (
      hostname === 'gideondefender.com' ||
      hostname.endsWith('.gideondefender.com')
    ) {
      prefix = 'better-auth';
    }
  } catch {
    // Unparseable BASE_URL — fall through to the local name.
  }
  const plain = `${prefix}.session_token`;
  return shouldUseSecureCookies() ? `${SECURE_COOKIE_PREFIX}${plain}` : plain;
}

/**
 * Both cookie-name variants, secure-prefixed first — the same order
 * better-auth reads (`__Secure-` then plain). Use for lookups so sessions
 * minted by either path (or before this fix) resolve.
 */
export function getSessionCookieNames(): string[] {
  const plain = getSessionCookieName().replace(SECURE_COOKIE_PREFIX, '');
  return [`${SECURE_COOKIE_PREFIX}${plain}`, plain];
}

export interface SessionCookieAttributes {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  domain?: string;
}

/**
 * Cookie attributes mirroring better-auth's `advanced` config in
 * `auth.server.ts` (cross-subdomain cookies + lax sameSite). The `secure`
 * flag follows `shouldUseSecureCookies()` so plain-HTTP dev logins stick.
 * Shared by better-auth logins and Gideon OIDC logins so sessions minted by
 * either path are read back identically by `HybridAuthGuard`.
 */
export function getSessionCookieAttributes(): SessionCookieAttributes {
  const domain = getCookieDomain();
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(),
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

/** Set the session cookie on a login response (Gideon OIDC path). */
export function setSessionCookie({
  res,
  token,
  expiresAt,
}: {
  res: Response;
  token: string;
  expiresAt: Date;
}): void {
  res.cookie(getSessionCookieName(), signSessionToken(token), {
    ...getSessionCookieAttributes(),
    expires: expiresAt,
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

/**
 * The secret session cookies are signed with (`auth.server.ts` passes the
 * same value as its `secret` option). Signing with anything else mints
 * cookies the native session resolver rejects, so a missing secret fails
 * closed here.
 */
export function getSessionSigningSecret(): string {
  const secret = process.env.SECRET_KEY;
  if (!secret) {
    throw new Error('SECRET_KEY is required to sign the session cookie');
  }
  return secret;
}

/**
 * Sign a raw session token for the cookie value (`token.signature`).
 * Byte-identical to better-call's `signCookieValue`: HMAC-SHA-256 over the
 * raw token, standard base64. Express applies the URI-encoding on write and
 * the native session resolver decodes before verifying, so this returns the
 * unencoded form. Unsigned cookie values never resolve — the resolver reads
 * the cookie with `getSignedCookie` and drops anything without a valid
 * signature.
 */
export function signSessionToken(token: string): string {
  const signature = createHmac('sha256', getSessionSigningSecret())
    .update(token, 'utf8')
    .digest('base64');
  return `${token}.${signature}`;
}

/**
 * Recover the raw session token from a presented cookie or bearer value:
 * URI-decodes, then strips the `.signature` suffix. Raw tokens (no suffix)
 * pass through unchanged. Returns null for missing or malformed values.
 */
export function unsignedSessionToken(
  value: string | undefined | null,
): string | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const dot = decoded.lastIndexOf('.');
  const token = dot > 0 ? decoded.slice(0, dot) : decoded;
  return token || null;
}

/** Clear every session-cookie variant on logout (secure + plain). */
export function clearSessionCookie({ res }: { res: Response }): void {
  const attributes = getSessionCookieAttributes();
  for (const name of getSessionCookieNames()) {
    res.clearCookie(name, attributes);
  }
}
