/**
 * Strict tenant-claim contract for OIDC bearer and MCP
 * JWTs.
 *
 * The IdP can issue the tenant under one of `tid`, `tenant_id`, `organizationId`
 * or `tenantId` depending on issuer configuration. OpenComp treats the tenant
 * ID as the Organization ID (tenant is the org). The key list is
 * configurable via OIDC_TENANT_CLAIM (comma-separated, same default order);
 * the strict rules below apply to whichever keys are configured.
 *
 * Strict rules (fail closed — any violation rejects the token, no fallback):
 * - missing: none of the configured claims present → reject.
 * - malformed: a present claim that is not a non-empty trimmed string → reject.
 * - conflicting: two or more present claims with distinct trimmed values →
 *   reject. Any alternative mapping requires an approved mapping contract.
 * - unknown: the resolved tenant has no matching Organization row → reject
 *   (enforced by the caller, not here).
 */
import { oidcTenantClaimKeys } from './oidc-env';

export type OidcTenantClaimError = 'missing' | 'malformed' | 'conflict';

export interface OidcTenantClaimOk {
  ok: true;
  tenantId: string;
}

export interface OidcTenantClaimFail {
  ok: false;
  reason: OidcTenantClaimError;
  detail: string;
}

export type OidcTenantClaimResult = OidcTenantClaimOk | OidcTenantClaimFail;

/** Canonical default tenant-claim keys. */
export const DEFAULT_TENANT_CLAIM_KEYS: readonly string[] = [
  'tid',
  'tenant_id',
  'organizationId',
  'tenantId',
];

/** Resolve the effective key list: explicit override, env config, default. */
function effectiveTenantClaimKeys(keys?: readonly string[]): readonly string[] {
  if (keys) return keys;
  return oidcTenantClaimKeys() ?? DEFAULT_TENANT_CLAIM_KEYS;
}

/** JWT-shaped bearer check (3 dot-segments) vs opaque session tokens. */
export function isJwtShaped(token: string): boolean {
  return token.split('.').length === 3;
}

/**
 * Coerce a verified `aal` claim to a finite number. Non-numeric shapes
 * (non-strings, empty or padded garbage, NaN, negatives) yield undefined so
 * callers treat the level as unknown instead of trusting a prefix parse.
 */
export function resolveOidcAal(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  if (!/^\d+$/.test(value.trim())) return undefined;
  const parsed = parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface CollectedTenantValue {
  key: string;
  value: string;
}

export interface CollectedTenantValues {
  seen: CollectedTenantValue[];
  malformedKey?: string;
}

/**
 * Shared iteration over the effective tenant-claim keys. Collects
 * present-but-usable values (trimmed non-empty strings) and records the
 * first present-but-unusable claim without deciding the outcome — the
 * callers reject malformed claims before any identity/session write.
 * Prefer this for iteration so strict and permissive paths cannot drift.
 * Reads env config only to resolve the default key list; pass explicit
 * `keys` in unit tests for hermetic coverage.
 */
export function collectTenantClaimValues({
  payload,
  keys,
}: {
  payload: Record<string, unknown>;
  keys?: readonly string[];
}): CollectedTenantValues {
  const seen: CollectedTenantValue[] = [];
  for (const key of effectiveTenantClaimKeys(keys)) {
    const raw = payload[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return { seen, malformedKey: key };
    }
    seen.push({ key, value: raw.trim() });
  }
  return { seen };
}

/**
 * Strict tenant-claim resolution per the tenant contract above.
 * Resolves the default key list from env config; pass explicit `keys`
 * in unit tests for hermetic coverage.
 */
export function resolveOidcTenantClaim(
  payload: Record<string, unknown>,
  keys?: readonly string[],
): OidcTenantClaimResult {
  const keyList = effectiveTenantClaimKeys(keys);
  const { seen, malformedKey } = collectTenantClaimValues({
    payload,
    keys: keyList,
  });
  if (malformedKey) {
    return {
      ok: false,
      reason: 'malformed',
      detail: `Gideon tenant claim "${malformedKey}" is present but not a non-empty string`,
    };
  }
  if (seen.length === 0) {
    return {
      ok: false,
      reason: 'missing',
      detail: `Gideon token carries no tenant claim (expected one of ${keyList.join(', ')})`,
    };
  }
  const distinct = new Set(seen.map((s) => s.value));
  if (distinct.size > 1) {
    return {
      ok: false,
      reason: 'conflict',
      detail: `Gideon token carries conflicting tenant claims: ${seen
        .map((s) => `${s.key}=${s.value}`)
        .join(', ')}`,
    };
  }
  return { ok: true, tenantId: seen[0].value };
}
