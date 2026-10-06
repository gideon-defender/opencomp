/**
 * Grant-shape predicates for GCP remediation validators.
 *
 * Pure shape checks shared by the fix-step parameter guardrails and the
 * rollback validators so the two cannot drift apart: public-grantee
 * detection (IAM members, GCS ACL entities, canned ACLs, BigQuery
 * `access`), never-allow privileged-role detection, and the POST-replay
 * rule (a POST rollback must replay a reviewed write, never invent one).
 * URL helpers come from `gcp-remediation-step-url.ts`; nothing else from
 * sibling validator modules — no cycles.
 */
import { isDeepStrictEqual } from 'node:util';
import { GCP_NEVER_ALLOW_ROLES } from '@gideon-defender/integration-platform';
import {
  isRecord,
  sameQueryIdentity,
  urlResource,
  type GcpStepInput,
} from './gcp-remediation-step-url';

function isNeverAllowRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return GCP_NEVER_ALLOW_ROLES.some(
    (denied) => denied.toLowerCase() === normalized,
  );
}

/** True for GCS ACL grantees that mean "the public internet". */
export function isPublicAclEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const entity = entry.entity;
  if (typeof entity !== 'string') return false;
  const normalized = entity.trim().toLowerCase();
  return normalized === 'allusers' || normalized === 'allauthenticatedusers';
}

/** True for `predefinedAcl` values that grant public access. */
export function isPublicPredefinedAcl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  // `authenticatedRead` grants READER to `allAuthenticatedUsers` — the
  // same public the ACL-entity check refuses, under a canned-ACL name.
  return (
    normalized === 'publicread' ||
    normalized === 'publicreadwrite' ||
    normalized === 'authenticatedread'
  );
}

/** True for IAM `bindings` members that mean "the public internet". */
export function isPublicIamMember(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'allusers' || normalized === 'allauthenticatedusers';
}

/**
 * True when an IAM-style `bindings` array grants any role to the public:
 * any binding whose `members` list contains `allUsers` or
 * `allAuthenticatedUsers`. Non-array and malformed inputs read as absent
 * (false) — callers checking a body they expect to carry bindings should
 * fail closed on the shape separately when the shape itself is required.
 */
export function bindingsGrantPublicAccess(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((binding) => {
    if (binding === null || typeof binding !== 'object') return false;
    if (Array.isArray(binding)) return false;
    const members = (binding as Record<string, unknown>).members;
    return Array.isArray(members) && members.some(isPublicIamMember);
  });
}

/**
 * True when an IAM-style `bindings` array grants a never-allow role
 * (`roles/owner`, `roles/editor`) to any principal. Public-member checks
 * miss a grant to a single attacker address — this catches the same
 * escalation under a narrower name.
 */
export function bindingsGrantPrivilegedRole(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((binding) => {
    if (binding === null || typeof binding !== 'object') return false;
    if (Array.isArray(binding)) return false;
    const record = binding as Record<string, unknown>;
    const role = record.role;
    if (typeof role !== 'string') return false;
    return isNeverAllowRole(role);
  });
}

/**
 * True when a BigQuery-style `access` array grants a never-allow role to
 * any principal. Dataset `access` entries carry the role in `role`, so the
 * same `roles/owner` grant that the IAM check misses here is caught too.
 */
export function datasetAccessGrantsPrivilegedRole(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    if (entry === null || typeof entry !== 'object') return false;
    if (Array.isArray(entry)) return false;
    const role = (entry as Record<string, unknown>).role;
    if (typeof role !== 'string') return false;
    return isNeverAllowRole(role);
  });
}

/**
 * True when a dataset `access` entry delegates to another resource's
 * readers instead of naming a grantee: an authorized `view`, `dataset`,
 * or `routine` reference. These entries carry no `role` key, so the
 * public, privileged-role, and single-principal gates all miss them —
 * yet adding one shares the dataset with whoever reads the referenced
 * resource. Only non-empty record references count: an empty object
 * grants nothing.
 */
export function isForeignResourceShareEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of ['view', 'dataset', 'routine']) {
    const ref = value[key];
    if (isRecord(ref) && Object.keys(ref).length > 0) return true;
  }
  return false;
}

/**
 * Foreign-share (`view`/`dataset`/`routine`) entries in a dataset
 * `access` list. Scoped to the documented `access` shape — the API only
 * honors references there, and sibling resource bodies never use these
 * keys for grants.
 */
export function accessForeignShareEntries(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isForeignResourceShareEntry(entry));
}
/**
 * True when a BigQuery-style `access` array grants dataset access to the
 * public: `specialGroup: allAuthenticatedUsers`, an `allUsers`-style
 * member entry, the IAM-policy member field `iamMember` carrying a public
 * value, or any `domain` grant (a whole external domain reads as public —
 * a narrow fix never shares a dataset with a domain). Mirrors
 * `bindingsGrantPublicAccess` for the dataset `access` shape, which uses
 * `specialGroup` instead of `members`. Single-identity fields
 * (`userByEmail`, `groupByEmail`) read as absent here: this predicate
 * answers "is it public", not "is it a new grant". Data-role grants to a
 * single identity are refused separately by the generic parameter gate
 * (`bodyGrantsSinglePrincipalDataRoleDeep`), which sees the role the
 * public-only check ignores.
 */
export function datasetAccessGrantsPublicAccess(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    if (entry === null || typeof entry !== 'object') return false;
    if (Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    if (isPublicIamMember(record.specialGroup)) return true;
    if (isPublicIamMember(record.iamMember)) return true;
    if (typeof record.domain === 'string' && record.domain.trim().length > 0)
      return true;
    if (Array.isArray(record.members) && record.members.some(isPublicIamMember))
      return true;
    return false;
  });
}

/**
 * Deep-scan an arbitrary body for privilege grants nested under any key:
 * `policy.bindings`, `iamPolicy.bindings`, dataset `access`, or any other
 * wrapper an allowlisted endpoint honors. A grant of `roles/owner` to one
 * address is the same escalation under any nesting.
 */
export function bodyGrantsPublicAccessDeep(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    if (
      bindingsGrantPublicAccess(value) ||
      datasetAccessGrantsPublicAccess(value)
    )
      return true;
    return value.some((entry) => bodyGrantsPublicAccessDeep(entry, depth + 1));
  }
  const record = value as Record<string, unknown>;
  if (isPublicIamMember(record.specialGroup)) return true;
  if (isPublicIamMember(record.iamMember)) return true;
  if (typeof record.domain === 'string' && record.domain.trim().length > 0)
    return true;
  // The query scan treats `member`/`members` values as grant vectors — the
  // body path agrees. Bare-string values never reach a shape check by
  // recursion (strings return false), so test the fields directly.
  if (isPublicIamMember(record.member)) return true;
  if (Array.isArray(record.members) && record.members.some(isPublicIamMember))
    return true;
  if (
    typeof record.entity === 'string' &&
    (record.entity.trim().toLowerCase() === 'allusers' ||
      record.entity.trim().toLowerCase() === 'allauthenticatedusers')
  )
    return true;
  return Object.values(record).some((entry) =>
    bodyGrantsPublicAccessDeep(entry, depth + 1),
  );
}

export function bodyGrantsPrivilegedRoleDeep(
  value: unknown,
  depth = 0,
): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    if (
      bindingsGrantPrivilegedRole(value) ||
      datasetAccessGrantsPrivilegedRole(value)
    )
      return true;
    return value.some((entry) =>
      bodyGrantsPrivilegedRoleDeep(entry, depth + 1),
    );
  }
  const record = value as Record<string, unknown>;
  if (typeof record.role === 'string') {
    if (isNeverAllowRole(record.role)) return true;
  }
  return Object.values(record).some((entry) =>
    bodyGrantsPrivilegedRoleDeep(entry, depth + 1),
  );
}

/**
 * POST rollbacks must replay a reviewed write, not invent one: a POST
 * with a novel body overlapping a fixed resource writes a third,
 * unreviewed state the overlap check alone cannot catch (overlap proves
 * *where*, never *what*). Fail closed without pre-fix state — same bar as
 * the IAM and PATCH paths. With state, the body must deep-equal an
 * overlapped fix step's body (same-index when the lists are 1:1, mirroring
 * the executor's positional compensation, else any overlapped fix write).
 * Positional pairing still verifies URL overlap — alignment is exactly
 * what an AI plan can get wrong, so the index is never trusted alone.
 * Fix steps reconstructed from applied-state command strings carry no
 * body (manual-rollback path) — with no reviewed body to compare, state
 * presence plus the parameter gates is the check there.
 */
export function validatePostRollback(args: {
  step: GcpStepInput;
  prefix: string;
  index: number;
  rollbackSteps: GcpStepInput[];
  fixSteps?: GcpStepInput[];
  previousState?: Record<string, unknown>;
}): string[] {
  const { step, prefix, index, rollbackSteps, fixSteps, previousState } = args;
  if (!previousState || Object.keys(previousState).length === 0) {
    return [
      `${prefix}: POST rollback has no pre-fix state to compare — a well-formed but fabricated rollback is still an unreviewed write — refused for safety`,
    ];
  }
  // No reviewed fix steps at all: nothing anchors the rollback to an
  // acknowledged write — refuse instead of treating absence as approval.
  if (!fixSteps || fixSteps.length === 0) {
    return [
      `${prefix}: POST rollback has no reviewed fix steps to replay — an unreviewed write, not a restore — refused for safety`,
    ];
  }
  const resource = urlResource(step.url);
  const positional =
    fixSteps.length > 0 && fixSteps.length === rollbackSteps.length;
  const overlaps = (fix: GcpStepInput): boolean => {
    const fixResource = urlResource(fix.url);
    const sameOrChild =
      resource === fixResource || resource.startsWith(`${fixResource}/`);
    if (!sameOrChild) return false;
    // Query-selected identity (`?name=` picks the SQL user) constrains
    // overlap the same way the path does — see `sameQueryIdentity`.
    if (!sameQueryIdentity(step, fix)) return false;
    return (
      fix.method === 'POST' || fix.method === 'PUT' || fix.method === 'PATCH'
    );
  };
  const candidates = positional
    ? [fixSteps[index]].filter(Boolean).filter(overlaps)
    : fixSteps.filter(overlaps);
  // No overlap means the rollback targets a resource no fix step touched:
  // a novel write, not a restore. (Bodiless candidates below are the
  // manual-rollback path — reviewed-by-position with state as the check.)
  if (candidates.length === 0) {
    return [
      `${prefix}: POST rollback targets a resource no reviewed fix step touched — an unreviewed write, not a restore — refused for safety`,
    ];
  }
  const reviewed = candidates.filter((fix) => fix.body !== undefined);
  if (reviewed.length === 0) return [];
  const body = step.body ?? {};
  if (reviewed.some((fix) => isDeepStrictEqual(body, fix.body ?? {}))) {
    return [];
  }
  return [
    `${prefix}: POST rollback body differs from the reviewed fix write it overlaps — refused for safety`,
  ];
}
