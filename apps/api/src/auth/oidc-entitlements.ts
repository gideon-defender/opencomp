import { ForbiddenException, Logger } from '@nestjs/common';
import { BUILT_IN_ROLE_PERMISSIONS } from '@gideon-defender/auth';
import { db } from '@db';
import {
  getValidRoleNames,
  splitRoleString,
  stripControlChars,
} from './app-access';

const logger = new Logger('OidcEntitlements');

export type EntitlementsDenyReason =
  'empty_entitlements' | 'no_valid_match' | 'unknown_tenant' | 'lookup_failed';

/** Phase 1 deny reasons that never appear in audit mode. */
export type EnforceDenyReason =
  Exclude<EntitlementsDenyReason, 'lookup_failed'> | 'no_owner_bootstrap';

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
 * Distinguished Phase 1 deny: empty/no-match/unknown-tenant (and bootstrap)
 * logins mint no session and redirect to `/auth?error=no_role`. The
 * controller maps this class — never messages — so identity-gate failures
 * (email/banned/sub) keep their own codes. Lookup/infra failures are NOT
 * this class: they propagate raw, land on `oidc_login_failed`, and still
 * mint no session (fail closed, distinct signal).
 */
export class EntitlementsDeniedError extends ForbiddenException {
  readonly reason: EnforceDenyReason;
  readonly tenantId?: string;

  constructor({
    reason,
    email,
    tenantId,
  }: {
    reason: EnforceDenyReason;
    email: string;
    tenantId?: string;
  }) {
    super(
      `OIDC login denied (${reason}) for ${stripControlChars(email)}` +
        (tenantId ? ` in tenant ${stripControlChars(tenantId)}` : '') +
        ': no valid IdP role assignment',
    );
    this.reason = reason;
    if (tenantId) this.tenantId = tenantId;
  }
}

export interface EvaluatedEntitlements {
  presented: string[];
  matched: string[];
  unmatched: string[];
  /** False when there is no tenant or no org row for it. */
  tenantKnown: boolean;
}

/**
 * Shared claim evaluation for audit and enforce. Reads the verified
 * ID-token `entitlements` claim and intersects against the org's valid role
 * names. Never logs, never writes. Throws on database failure so callers
 * choose: audit catches (login proceeds), enforce propagates (login fails
 * closed with no session).
 */
export async function evaluateEntitlements({
  claims,
  tenantId,
}: {
  claims: unknown;
  tenantId?: string;
}): Promise<EvaluatedEntitlements> {
  const presented = parseEntitlementsClaim(claims);
  if (!tenantId) {
    return { presented, matched: [], unmatched: presented, tenantKnown: false };
  }
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!org) {
    // No org row: custom roles cannot exist, so intersect against built-ins
    // only. The match is used solely by the bootstrap gate (a verified
    // app-specific `owner` admits restricted setup); enforce and audit both
    // treat tenantKnown=false as deny/unknown regardless of matched.
    const builtIns = new Set(Object.keys(BUILT_IN_ROLE_PERMISSIONS));
    return {
      presented,
      matched: presented.filter((v) => builtIns.has(v)),
      unmatched: presented.filter((v) => !builtIns.has(v)),
      tenantKnown: false,
    };
  }
  const valid = await getValidRoleNames(tenantId);
  return {
    presented,
    matched: presented.filter((v) => valid.has(v)),
    unmatched: presented.filter((v) => !valid.has(v)),
    tenantKnown: true,
  };
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
  // Email and tenant are IdP-controlled: strip control characters once so no
  // log line below can be forged, even if the IdP is compromised.
  const logEmail = stripControlChars(email);
  const logTenant = stripControlChars(tenantId ?? '<none>');
  try {
    if (!tenantId) {
      logger.warn(
        `oidc.entitlements.audit would_deny reason=unknown_tenant email=${logEmail} tenant=${logTenant} presented=[${presented.join(',')}]`,
      );
      return {
        presented,
        matched: [],
        unmatched: presented,
        wouldDeny: true,
        reason: 'unknown_tenant',
      };
    }

    const evaluated = await evaluateEntitlements({ claims, tenantId });
    const { matched, unmatched } = evaluated;

    if (!evaluated.tenantKnown) {
      logger.warn(
        `oidc.entitlements.audit would_deny reason=unknown_tenant email=${logEmail} tenant=${logTenant} presented=[${presented.join(',')}]`,
      );
      return {
        presented,
        matched: [],
        unmatched: presented,
        wouldDeny: true,
        reason: 'unknown_tenant',
      };
    }

    if (matched.length === 0) {
      const reason: EntitlementsDenyReason =
        presented.length === 0 ? 'empty_entitlements' : 'no_valid_match';
      logger.warn(
        `oidc.entitlements.audit would_deny reason=${reason} email=${logEmail} tenant=${logTenant} presented=[${presented.join(',')}] unmatched=[${unmatched.join(',')}]`,
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
      `oidc.entitlements.audit ${wouldOverwrite ? 'would_overwrite' : 'would_keep'} email=${logEmail} tenant=${logTenant} presented=[${presented.join(',')}] matched=[${matched.join(',')}] current=[${currentLabel}]`,
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
      `oidc.entitlements.audit audit_error email=${logEmail} tenant=${logTenant} error=${error instanceof Error ? error.message : String(error)}`,
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
 * Phase 1 enforcement for a pilot tenant (and the fleet once the allowlist
 * covers it). Evaluates the verified claim and either returns the matched
 * role names or throws EntitlementsDeniedError — the caller mints no session
 * on any throw. Database failures propagate raw (fail closed, distinct
 * `oidc_login_failed` signal, still no session).
 */
export async function enforceOidcEntitlements({
  claims,
  email,
  tenantId,
}: {
  claims: unknown;
  email: string;
  tenantId: string;
}): Promise<{ matched: string[] }> {
  const { presented, matched, unmatched, tenantKnown } =
    await evaluateEntitlements({ claims, tenantId });
  const logEmail = stripControlChars(email);
  const logTenant = stripControlChars(tenantId);

  if (!tenantKnown) {
    logger.warn(
      `oidc.entitlements.enforce deny reason=unknown_tenant email=${logEmail} tenant=${logTenant} presented=[${presented.join(',')}]`,
    );
    throw new EntitlementsDeniedError({
      reason: 'unknown_tenant',
      email,
      tenantId,
    });
  }

  if (matched.length === 0) {
    const reason: EnforceDenyReason =
      presented.length === 0 ? 'empty_entitlements' : 'no_valid_match';
    logger.warn(
      `oidc.entitlements.enforce deny reason=${reason} email=${logEmail} tenant=${logTenant} presented=[${presented.join(',')}] unmatched=[${unmatched.join(',')}]`,
    );
    throw new EntitlementsDeniedError({ reason, email, tenantId });
  }

  logger.log(
    `oidc.entitlements.enforce grant email=${logEmail} tenant=${logTenant} matched=[${matched.join(',')}] unmatched=[${unmatched.join(',')}]`,
  );
  return { matched };
}

/**
 * Extract the `entitlements` claim as a string array. The IdP omits the
 * claim when empty, so absent/invalid shapes all mean the same thing to the
 * consumer: no presented entitlements. Non-string and blank entries are
 * dropped; the survivors are trimmed. Values with control characters are
 * rejected so log safety cannot turn an unknown value into a valid role.
 * Duplicates are kept as presented so the log shows what the IdP sent; the overwrite check compares sets.
 */
export function parseEntitlementsClaim(claims: unknown): string[] {
  if (!claims || typeof claims !== 'object') return [];
  const raw = (claims as Record<string, unknown>).entitlements;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string')
    .filter((v) => stripControlChars(v) === v)
    .map((v) => v.trim())
    .filter(Boolean);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}
