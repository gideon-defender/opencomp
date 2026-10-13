import { createHmac, timingSafeEqual } from 'node:crypto';

function getUnsubscribeSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('UNSUBSCRIBE_SECRET or AUTH_SECRET must be set to sign unsubscribe tokens');
  }
  return secret;
}

/**
 * Canonical email form for tenant-scoped uniqueness.
 *
 * Contract: identical to `normalizeEmail` in `@gideon-defender/db`
 * (`packages/db/src/normalize-email.ts`) — `trim().toLowerCase()`. The email
 * package must not import `@db` (tsup bundle; `check-unsubscribe` takes the
 * db handle by DI for the same reason), so the one-liner lives in exactly
 * these two places by design. The apps/api and apps/app prisma shims
 * re-export this copy. Keep both in sync; the contract tests on each side
 * pin it.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function signUnsubPayload(payload: string): string {
  const hmac = createHmac('sha256', getUnsubscribeSecret());
  hmac.update(payload);
  return hmac.digest('base64url');
}

/**
 * Constant-time compare that never throws: the byte-length guard runs on
 * encoded bytes (a multi-byte token passes a string-length check with a
 * different byte length, which used to throw inside timingSafeEqual).
 */
function tokensEqual(a: string, b: string): boolean {
  const encodedA = Buffer.from(a);
  const encodedB = Buffer.from(b);
  return encodedA.length === encodedB.length && timingSafeEqual(encodedA, encodedB);
}

/**
 * Get the base URL for unsubscribe links based on environment
 * Uses NEXT_PUBLIC_BETTER_AUTH_URL for staging/prod, falls back to NEXT_PUBLIC_APP_URL,
 * and handles localhost for local development
 */
function getBaseUrl(): string {
  // Prefer NEXT_PUBLIC_BETTER_AUTH_URL (used for staging/prod)
  if (process.env.NEXT_PUBLIC_BETTER_AUTH_URL) {
    return process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
  }

  // Fallback to NEXT_PUBLIC_APP_URL
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  // Default fallback
  return 'https://app.gideondefender.com';
}

/**
 * Legacy email-only token (HMAC of the normalized email). In-flight emails
 * keep working: verifiers also accept the pre-scoping form (HMAC of the raw
 * address), so links minted before normalization still verify. Verifiers
 * must NOT act on this token when several tenant accounts share the
 * address — see the API controller's ambiguity guard. New senders that know
 * the recipient's user id should use generateUserUnsubscribeToken instead.
 */
export function generateUnsubscribeToken(email: string): string {
  return signUnsubPayload(normalizeEmail(email));
}

/**
 * User-scoped token: binds the token to one tenant account so the same
 * address in another tenant cannot reuse it. New senders should emit
 * getUserUnsubscribeUrl(userId, email).
 */
export function generateUserUnsubscribeToken(params: {
  userId: string;
  email: string;
  organizationId?: string;
}): string {
  if (params.organizationId) {
    return signUnsubPayload(
      JSON.stringify([
        'tenant-v2',
        params.organizationId,
        params.userId,
        normalizeEmail(params.email),
      ]),
    );
  }
  return signUnsubPayload(`${params.userId}:${normalizeEmail(params.email)}`);
}

/**
 * Verify an unsubscribe token matches an email address (legacy path).
 * Accepts the normalized form and, for in-flight transition, the raw form
 * minted before tenant scoping.
 */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  if (tokensEqual(generateUnsubscribeToken(email), token)) return true;
  return tokensEqual(signUnsubPayload(email), token);
}

/** Verify a user-scoped token for exactly one tenant account. */
export function verifyUserUnsubscribeToken(params: {
  userId: string;
  email: string;
  token: string;
  organizationId?: string;
}): boolean {
  return tokensEqual(generateUserUnsubscribeToken(params), params.token);
}

/**
 * Generate an unsubscribe URL for an email address (preferences page).
 * Pass the recipient's user id when known so the link is bound to one
 * tenant account (user-scoped token); otherwise a legacy email-only link
 * is emitted, which verifiers reject as ambiguous when several tenants
 * share the address.
 */
export function getUnsubscribeUrl(email: string, userId?: string): string {
  if (userId) return getUserUnsubscribeUrl({ userId, email });
  const token = generateUnsubscribeToken(email);
  const baseUrl = getBaseUrl();
  return `${baseUrl}/unsubscribe/preferences?email=${encodeURIComponent(email)}&token=${token}`;
}

/** User/tenant-scoped unsubscribe URL for one tenant account. */
export function getUserUnsubscribeUrl(params: {
  userId: string;
  email: string;
  organizationId?: string;
}): string {
  const token = generateUserUnsubscribeToken(params);
  const baseUrl = getBaseUrl();
  return `${baseUrl}/unsubscribe/preferences?userId=${encodeURIComponent(params.userId)}&email=${encodeURIComponent(params.email)}&token=${token}${params.organizationId ? `&organizationId=${encodeURIComponent(params.organizationId)}` : ''}`;
}
