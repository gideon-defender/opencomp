import { Logger } from '@nestjs/common';
import { db } from '@db';
import { stripControlChars } from './app-access';
import {
  EntitlementsDeniedError,
  evaluateEntitlements,
} from './gideon-oidc-entitlements';

const logger = new Logger('OidcBootstrapGate');

/**
 * Rollout helpers for IdP-owned entitlements (env-driven, read per login).
 *
 * Split from `gideon-oidc-entitlements` so the evaluation module stays
 * under the 300-line limit. The env levers never touch the database; the
 * tenant check and bootstrap gate below read it.
 */

/**
 * All-tenant enforcement takes precedence over the pilot allowlist.
 * With both controls unset, logins stay in audit mode. Clear all-tenant
 * mode and the allowlist to roll back enforcement (rows stay as
 * last synced, fences stay up — no local grants are restored).
 */
export function isEnforcementEnabledFor(tenantId: string | undefined): boolean {
  if (!tenantId) return false;
  if (process.env.GIDEON_ENFORCEMENT_ALL_TENANTS === 'true') return true;
  const raw = process.env.GIDEON_ENFORCEMENT_TENANTS ?? '';
  const allowlist = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return allowlist.has(tenantId);
}

/**
 * Bootstrap gate (Phase 5 prerequisite): when true, unknown-tenant logins
 * without a verified app-specific `owner` entitlement are denied instead of
 * flowing into self-service setup. Enable only after IdP tenant
 * provisioning seeds an owner assignment per tenant — otherwise new
 * signups brick.
 */
export function isBootstrapEnforced(): boolean {
  return process.env.GIDEON_BOOTSTRAP_ENFORCED === 'true';
}

/** True when the org row for the tenant exists; false for unknown tenants. */
export async function isKnownTenant(
  tenantId: string | undefined,
): Promise<boolean> {
  if (!tenantId) return false;
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  return org !== null;
}

/**
 * Phase 5 bootstrap gate for unknown tenants: a login the tenant allowlist
 * doesn't cover and with no org row may only enter restricted setup when
 * it carries a verified app-specific `owner` entitlement (the claim is
 * per-application, so a matched owner is app-specific by construction).
 * Anything else is denied — setup must never mint a local owner grant.
 * Lookup failures propagate so a temporary outage cannot bypass the gate.
 */
export async function enforceBootstrapGate({
  claims,
  email,
  tenantId,
}: {
  claims: unknown;
  email: string;
  tenantId?: string;
}): Promise<void> {
  const logEmail = stripControlChars(email);
  if (await isKnownTenant(tenantId)) return;
  const logTenant = stripControlChars(tenantId ?? '<none>');
  const { matched, presented } = await evaluateEntitlements({
    claims,
    tenantId,
  });
  if (matched.includes('owner')) {
    logger.log(
      `oidc.entitlements.enforce grant reason=owner_bootstrap email=${logEmail} tenant=${logTenant} presented=[${presented.join(',')}]`,
    );
    return;
  }
  logger.warn(
    `oidc.entitlements.enforce deny reason=no_owner_bootstrap email=${logEmail} tenant=${logTenant} presented=[${presented.join(',')}]`,
  );
  throw new EntitlementsDeniedError({
    reason: 'no_owner_bootstrap',
    email,
    tenantId,
  });
}
