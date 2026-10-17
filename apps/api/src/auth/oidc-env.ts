import { Logger } from '@nestjs/common';

const logger = new Logger('OidcEnv');
const warnedKeys = new Set<string>();

/**
 * OIDC environment settings with deprecated-key compatibility.
 *
 * Reads `primary` (OIDC_*) first, then the deprecated `legacy` (GIDEON_*)
 * name, then any silent aliases (pre-existing generic names like
 * AUTH__IDENTITY_URL / JWT_ISSUER that are not deprecations). Empty strings
 * count as unset so a blank primary never shadows a configured fallback.
 * Falling back to a deprecated key logs a one-time warn per key.
 */
export function oidcEnv(
  primary: string,
  legacy?: string,
  ...silentAliases: string[]
): string | undefined {
  const direct = process.env[primary];
  if (direct !== undefined && direct !== '') return direct;
  const fallbacks = [legacy, ...silentAliases].filter(
    (key): key is string => !!key,
  );
  for (const key of fallbacks) {
    const value = process.env[key];
    if (value === undefined || value === '') continue;
    if (key === legacy && !warnedKeys.has(key)) {
      warnedKeys.add(key);
      logger.warn(`Deprecated env ${key} in use — rename to ${primary}`);
    }
    return value;
  }
  return undefined;
}

/** Test-only reset for the once-per-key deprecation warn. */
export function resetOidcEnvWarnings(): void {
  warnedKeys.clear();
}

/** Boolean flag: strictly 'true' enables. */
export function oidcEnvBool(primary: string, legacy?: string): boolean {
  return oidcEnv(primary, legacy) === 'true';
}

/**
 * Loopback hosts where plain-HTTP OIDC endpoints are tolerated (local dev).
 * Shared by login discovery and JWT JWKS discovery — one rule, one place.
 */
export function isLoopbackHost(hostname: string): boolean {
  // Node's WHATWG URL keeps IPv6 brackets (`[::1]`); accept both forms.
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

/** Issuer base URL used for discovery + JWKS. */
export function oidcIdentityUrl(): string | undefined {
  return oidcEnv(
    'OIDC_ISSUER_URL',
    'GIDEON_IDENTITY_URL',
    'AUTH__IDENTITY_URL',
  );
}

/** OAuth client id for this app. */
export function oidcClientId(): string | undefined {
  return oidcEnv('OIDC_CLIENT_ID', 'GIDEON_OIDC_CLIENT_ID');
}

/** Optional client secret (public apps have none; PKCE-bound `none` auth). */
export function oidcClientSecret(): string | undefined {
  return oidcEnv('OIDC_CLIENT_SECRET', 'GIDEON_OIDC_CLIENT_SECRET');
}

/** Registered redirect URI for the callback. */
export function oidcRedirectUri(): string | undefined {
  return oidcEnv('OIDC_REDIRECT_URI', 'GIDEON_OIDC_REDIRECT_URI');
}

/** Space-separated scopes; defaults to `openid profile email`. */
export function oidcScopes(): string {
  return oidcEnv('OIDC_SCOPES', 'GIDEON_OIDC_SCOPES') || 'openid profile email';
}

/** Expected JWT issuer for the Bearer path. */
export function oidcJwtIssuer(): string | null {
  return oidcEnv('OIDC_JWT_ISSUER', 'GIDEON_JWT_ISSUER', 'JWT_ISSUER') || null;
}

/** Expected JWT audience for the Bearer path. */
export function oidcJwtAudience(): string | null {
  return (
    oidcEnv('OIDC_JWT_AUDIENCE', 'GIDEON_JWT_AUDIENCE', 'JWT_AUDIENCE') || null
  );
}

/** Enforce-mode for the Bearer path (hard-fail presenting tokens). */
export function oidcJwtEnabled(): boolean {
  return oidcEnvBool('OIDC_JWT_ENABLED', 'GIDEON_JWT_ENABLED');
}

/** Raw shadow flag (tri-state: 'true' | 'false' | undefined → auto). */
export function oidcJwtShadowFlag(): string | undefined {
  return oidcEnv('OIDC_JWT_SHADOW_ENABLED', 'GIDEON_JWT_SHADOW_ENABLED');
}

/** Raw JWKS cache TTL in seconds. */
export function oidcJwksCacheTtlSecs(): string | undefined {
  return oidcEnv(
    'OIDC_JWKS_CACHE_TTL_SECS',
    'GIDEON_JWKS_CACHE_TTL_SECS',
    'AUTH__JWKS_CACHE_TTL_SECS',
  );
}

/** Parsed JWKS cache TTL in seconds (defaults to 300 on unset/invalid). */
export function oidcJwksCacheTtl(): number {
  const raw = oidcJwksCacheTtlSecs();
  const parsed = raw ? parseInt(raw, 10) : 300;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

/** All-tenant enforcement takes precedence over the pilot allowlist. */
export function oidcEnforcementAllTenants(): boolean {
  return oidcEnvBool(
    'OIDC_ENFORCEMENT_ALL_TENANTS',
    'GIDEON_ENFORCEMENT_ALL_TENANTS',
  );
}

/** Raw pilot-allowlist CSV (parsed by the caller). */
export function oidcEnforcementTenants(): string {
  return (
    oidcEnv('OIDC_ENFORCEMENT_TENANTS', 'GIDEON_ENFORCEMENT_TENANTS') ?? ''
  );
}

/** Unknown-tenant bootstrap gate. */
export function oidcBootstrapEnforced(): boolean {
  return oidcEnvBool('OIDC_BOOTSTRAP_ENFORCED', 'GIDEON_BOOTSTRAP_ENFORCED');
}

/** Reconciliation worker master switch. */
export function oidcReconciliationEnabled(): boolean {
  return oidcEnvBool(
    'OIDC_ENTITLEMENTS_RECONCILIATION_ENABLED',
    'GIDEON_ENTITLEMENTS_RECONCILIATION_ENABLED',
  );
}

/** Reader base URL (falls back to the issuer URL, as before). */
export function oidcReconciliationReaderUrl(): string | undefined {
  return (
    oidcEnv('OIDC_ENTITLEMENTS_READER_URL', 'GIDEON_ENTITLEMENTS_READER_URL') ||
    oidcIdentityUrl()
  );
}

/** Reader service credential. */
export function oidcReconciliationReadToken(): string | undefined {
  return oidcEnv(
    'OIDC_ENTITLEMENTS_READ_TOKEN',
    'GIDEON_ENTITLEMENTS_READ_TOKEN',
  );
}

/** PagerDuty routing key for reconciliation alerts. */
export function oidcReconciliationPagerdutyKey(): string | undefined {
  return oidcEnv(
    'OIDC_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY',
    'GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY',
  );
}

/** Dev-only paging skip. */
export function oidcReconciliationSkipPaging(): boolean {
  return oidcEnvBool(
    'OIDC_ENTITLEMENTS_SKIP_PAGING',
    'GIDEON_ENTITLEMENTS_SKIP_PAGING',
  );
}

/**
 * Configured tenant-claim keys (generic-oidc-readiness §5.4).
 * Comma-separated claim names; undefined when unset/blank so callers fall
 * back to the canonical default in `tenant-claim`.
 */
export function oidcTenantClaimKeys(): string[] | undefined {
  const raw = oidcEnv('OIDC_TENANT_CLAIM', 'GIDEON_TENANT_CLAIM');
  if (!raw) return undefined;
  const keys = raw
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.length > 0 ? keys : undefined;
}

/**
 * Require verified email by default. 'false' permits an omitted flag only
 * for already linked subjects. Unverified addresses cannot create, link,
 * or rename accounts.
 */
export function oidcRequireEmailVerified(): boolean {
  return (
    oidcEnv('OIDC_REQUIRE_EMAIL_VERIFIED', 'GIDEON_REQUIRE_EMAIL_VERIFIED') !==
    'false'
  );
}
