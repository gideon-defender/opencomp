/**
 * Phase 0 (Gram auth cutover) — explicit tenant-claim contract for MCP/Gideon
 * JWTs.
 *
 * Gideon issues the tenant under one of `tid`, `tenant_id`, `organizationId`
 * or `tenantId` depending on issuer configuration. OpenComp treats the tenant
 * ID as the Organization ID (tenant is the org).
 *
 * Strict rules (fail closed — any violation rejects the token, no fallback):
 * - missing: none of the four claims present → reject.
 * - malformed: a present claim that is not a non-empty trimmed string → reject.
 * - conflicting: two or more present claims with distinct trimmed values →
 *   reject. Any alternative mapping requires an approved mapping contract.
 * - unknown: the resolved tenant has no matching Organization row → reject
 *   (enforced by the caller, not here).
 */
export type GideonTenantClaimError = 'missing' | 'malformed' | 'conflict';

export interface GideonTenantClaimOk {
  ok: true;
  tenantId: string;
}

export interface GideonTenantClaimFail {
  ok: false;
  reason: GideonTenantClaimError;
  detail: string;
}

export type GideonTenantClaimResult =
  GideonTenantClaimOk | GideonTenantClaimFail;

const TENANT_CLAIM_KEYS = [
  'tid',
  'tenant_id',
  'organizationId',
  'tenantId',
] as const;

export type TenantClaimKey = (typeof TENANT_CLAIM_KEYS)[number];

/** Canonical tenant-claim key list. Prefer `collectTenantClaimValues` for iteration so strict and permissive paths cannot drift. */
export const GIDEON_TENANT_CLAIM_KEYS: readonly TenantClaimKey[] =
  TENANT_CLAIM_KEYS;

/** JWT-shaped bearer check (3 dot-segments) vs opaque session tokens. */
export function isJwtShaped(token: string): boolean {
  return token.split('.').length === 3;
}

/**
 * Coerce a verified `aal` claim to a finite number. Non-numeric shapes
 * (non-strings, empty or padded garbage, NaN, negatives) yield undefined so
 * callers treat the level as unknown instead of trusting a prefix parse.
 */
export function resolveGideonAal(value: unknown): number | undefined {
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
 * Shared iteration over the canonical tenant-claim keys. Collects
 * present-but-usable values (trimmed non-empty strings) and records the
 * first present-but-unusable claim without deciding the outcome — the
 * callers reject malformed claims before any identity/session write.
 * Pure function, no I/O.
 */
export function collectTenantClaimValues({
  payload,
}: {
  payload: Record<string, unknown>;
}): CollectedTenantValues {
  const seen: CollectedTenantValue[] = [];
  for (const key of TENANT_CLAIM_KEYS) {
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
 * Strict tenant-claim resolution per the Phase 0 contract above.
 * Pure function — no I/O, safe to unit-test exhaustively.
 */
export function resolveGideonTenantClaim(
  payload: Record<string, unknown>,
): GideonTenantClaimResult {
  const { seen, malformedKey } = collectTenantClaimValues({ payload });
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
      detail:
        'Gideon token carries no tenant claim (expected one of tid, tenant_id, organizationId, tenantId)',
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
