import { Logger } from '@nestjs/common';
import { db } from '@db';
import { getValidRoleNames, splitRoleString } from './app-access';

const logger = new Logger('GideonOidcEntitlements');

export type EntitlementsDenyReason =
  'empty_entitlements' | 'no_valid_match' | 'unknown_tenant' | 'lookup_failed';

export interface EntitlementsAuditResult {
  presented: string[];
  matched: string[];
  unmatched: string[];
  wouldDeny: boolean;
  reason?: EntitlementsDenyReason;
  /** Current cached Member.role for the user in the tenant org, if any. */
  memberRole?: string | null;
  /**
   * Set when `wouldDeny` is false: whether Phase 1 would overwrite the
   * cached Member.role with the matched entitlements.
   */
  wouldOverwrite?: boolean;
}

export interface AuditOidcEntitlementsParams {
  /** Verified ID-token claims from tokens.claims() — never the access token. */
  claims: unknown;
  userId: string;
  email: string;
  tenantId?: string;
}

/**
 * Phase 0 audit-mode entitlements check.
 *
 * Reads the verified ID-token `entitlements` claim, intersects the presented
 * values against that org's valid role names (built-ins ∪ its
 * `OrganizationRole` rows; entries are trimmed, then matched verbatim —
 * no translation table in v1), and logs what Phase 1 enforcement *would* do.
 *
 * Audit mode only: never throws, never denies, never writes a Member row.
 * Callers proceed with the old behavior (mint session) regardless of the
 * result. Fail-closed at login and Member overwrite arrive in Phase 1.
 */
export async function auditOidcEntitlements({
  claims,
  userId,
  email,
  tenantId,
}: AuditOidcEntitlementsParams): Promise<EntitlementsAuditResult> {
  // Parsed up front so the catch path can still report what the IdP sent
  // when a later database lookup fails.
  const presented = parseEntitlementsClaim(claims);
  try {
    if (!tenantId) {
      logger.warn(
        `oidc.entitlements.audit would_deny reason=unknown_tenant email=${email} tenant=<none> presented=[${presented.join(',')}]`,
      );
      return {
        presented,
        matched: [],
        unmatched: presented,
        wouldDeny: true,
        reason: 'unknown_tenant',
      };
    }

    const org = await db.organization.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!org) {
      logger.warn(
        `oidc.entitlements.audit would_deny reason=unknown_tenant email=${email} tenant=${tenantId} presented=[${presented.join(',')}]`,
      );
      return {
        presented,
        matched: [],
        unmatched: presented,
        wouldDeny: true,
        reason: 'unknown_tenant',
      };
    }

    const valid = await getValidRoleNames(tenantId);
    const matched = presented.filter((v) => valid.has(v));
    const unmatched = presented.filter((v) => !valid.has(v));

    if (matched.length === 0) {
      const reason: EntitlementsDenyReason =
        presented.length === 0 ? 'empty_entitlements' : 'no_valid_match';
      logger.warn(
        `oidc.entitlements.audit would_deny reason=${reason} email=${email} tenant=${tenantId} presented=[${presented.join(',')}] unmatched=[${unmatched.join(',')}]`,
      );
      return { presented, matched, unmatched, wouldDeny: true, reason };
    }

    const member = await db.member.findFirst({
      where: { userId, organizationId: tenantId },
      select: { role: true },
    });
    const current = splitRoleString(member?.role ?? null);
    const matchedUnique = [...new Set(matched)];
    const wouldOverwrite = current === null || !sameSet(current, matchedUnique);
    const currentLabel =
      current === null || current.length === 0 ? '<none>' : current.join(',');
    logger.log(
      `oidc.entitlements.audit ${wouldOverwrite ? 'would_overwrite' : 'would_keep'} email=${email} tenant=${tenantId} presented=[${presented.join(',')}] matched=[${matched.join(',')}] current=[${currentLabel}]`,
    );
    return {
      presented,
      matched,
      unmatched,
      wouldDeny: false,
      memberRole: member?.role ?? null,
      wouldOverwrite,
    };
  } catch (error) {
    // Audit must never break login. A lookup failure is not a deny signal —
    // log it distinctly so the per-tenant report doesn't count it as a gap.
    logger.error(
      `oidc.entitlements.audit audit_error email=${email} tenant=${tenantId ?? '<none>'} error=${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      presented,
      matched: [],
      unmatched: [],
      wouldDeny: false,
      reason: 'lookup_failed',
    };
  }
}

/**
 * Extract the `entitlements` claim as a string array. The IdP omits the
 * claim when empty, so absent/invalid shapes all mean the same thing to the
 * consumer: no presented entitlements. Non-string and blank entries are
 * dropped; the survivors are trimmed. Duplicates are kept as presented so
 * the log shows what the IdP sent; the overwrite check compares sets.
 */
export function parseEntitlementsClaim(claims: unknown): string[] {
  if (!claims || typeof claims !== 'object') return [];
  const raw = (claims as Record<string, unknown>).entitlements;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}
