import { isLoopbackHost } from './oidc-env';

/**
 * Discovery-document JWKS resolution (generic-oidc-readiness §5 step 5).
 *
 * Reads `jwks_uri` from `{issuer}/.well-known/openid-configuration` instead of
 * assuming a fixed `/.well-known/jwks.json` path, so IdPs that publish JWKS
 * elsewhere (custom domains, realm paths) verify on the Bearer path too.
 * The document's `issuer` must match the requested base (trailing slashes
 * ignored) — a doc for another issuer is rejected. Returns null when
 * discovery is unreachable, malformed, mismatched, or advertises an
 * unusable URL — callers fall back or fail closed from there.
 */
export async function fetchDiscoveryJwksUri(
  issuerBase: string,
  timeoutMs = 10000,
): Promise<string | null> {
  if (!isUsableJwksUrl(issuerBase)) return null;
  let response: Response;
  try {
    response = await fetch(`${issuerBase}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let doc: unknown;
  try {
    doc = await response.json();
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return null;
  }
  const { issuer, jwks_uri: jwksUri } = doc as {
    issuer?: unknown;
    jwks_uri?: unknown;
  };
  if (
    typeof issuer !== 'string' ||
    normalizeIssuer(issuer) !== normalizeIssuer(issuerBase)
  ) {
    return null;
  }
  if (typeof jwksUri !== 'string' || !isUsableJwksUrl(jwksUri)) return null;
  return jwksUri;
}

/** Issuer comparison ignoring trailing slashes. */
function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Usable JWKS/issuer URL: https anywhere, plain http for loopback issuers
 * only (local dev). Mirrors the login-discovery rule — anything else fails
 * closed instead of fetching keys over MITM-able HTTP.
 */
export function isUsableJwksUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))
  );
}
