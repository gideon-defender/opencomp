import { GCP_NEVER_ALLOW_ROLES } from '@gideon-defender/integration-platform';
import { isDeepStrictEqual } from 'node:util';
import {
  accessForeignShareEntries,
  bindingsGrantPrivilegedRole,
  bindingsGrantPublicAccess,
  bodyGrantsPrivilegedRoleDeep,
  bodyGrantsPublicAccessDeep,
  datasetAccessGrantsPrivilegedRole,
  datasetAccessGrantsPublicAccess,
  isRecord,
  stepQueryParamValues,
  type GcpStepInput,
} from './gcp-remediation-validator-shared';
import {
  findPriorStateValue,
  type GcpReadStepRef,
  type GcpStepIdentity,
} from './gcp-remediation-prior-state';

/**
 * BigQuery data roles that must never be granted to a new single principal
 * by a fix write. The privileged-role check misses them: `READER`,
 * `roles/bigquery.dataViewer`, and `roles/bigquery.dataEditor` are not
 * admin roles, but granting any of them to one attacker address shares the
 * dataset with the attacker — the same exposure as a public grant under a
 * narrower name (`dataEditor` additionally grants writes). Compared
 * case-insensitively: legacy access roles are uppercase (`READER`) while
 * IAM roles are lowercase (`roles/...`), and a case game must not decide
 * what a grant means.
 */
function isBqSinglePrincipalDataRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === 'reader' ||
    normalized === 'roles/bigquery.dataviewer' ||
    normalized === 'roles/bigquery.dataeditor'
  );
}

/** True when the record names one concrete identity (not a group/public). */
function namesBqSingleIdentity(record: Record<string, unknown>): boolean {
  for (const key of ['userByEmail', 'groupByEmail']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return true;
  }
  // `iamMember` names the same identity in `type:value` form
  // (`user:a@b`, `group:g`, `domain:d`, `serviceAccount:sa`). The public
  // gates above already refused allUsers-style values, so any remaining
  // non-empty value names one concrete identity the role check must see.
  const iamMember = record.iamMember;
  if (typeof iamMember === 'string' && iamMember.trim().length > 0) return true;
  return false;
}

/**
 * True when any record in the body grants a BigQuery data role to a single
 * identity: a dataset `access` entry, or the same shape nested under any
 * key an allowlisted endpoint honors. Public grants and privileged roles
 * are refused elsewhere — this catches the read or edit grant to one address that
 * both miss. Rollback restores skip this refusal (see the gate below):
 * restoring the exact prior value is proven by prior-state comparison,
 * not by the fix-flow grant gates.
 */
function bodyGrantsSinglePrincipalDataRoleDeep(
  value: unknown,
  depth = 0,
): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((entry) => {
      if (isRecord(entry)) {
        const role = entry.role;
        if (
          typeof role === 'string' &&
          isBqSinglePrincipalDataRole(role) &&
          namesBqSingleIdentity(entry)
        )
          return true;
      }
      return bodyGrantsSinglePrincipalDataRoleDeep(entry, depth + 1);
    });
  }
  if (isRecord(value)) {
    const role = value.role;
    if (
      typeof role === 'string' &&
      isBqSinglePrincipalDataRole(role) &&
      namesBqSingleIdentity(value)
    )
      return true;
  }
  return Object.values(value).some((entry) =>
    bodyGrantsSinglePrincipalDataRoleDeep(entry, depth + 1),
  );
}

/**
 * Generic public-grant gate for allowlisted writes without a dedicated
 * parameter validator (BigQuery datasets, PubSub/KMS non-`:setIamPolicy`
 * shapes, DNS, monitoring, non-firewall Compute). Endpoint prefixes alone
 * cannot tell a fix value from a posture-widening value, so any write
 * body granting a role to the public refuses. Hosts with dedicated
 * validators return their own errors instead — this is the backstop, not
 * a replacement.
 *
 * Only public grants refuse here: additive dataset entries (e.g. a log
 * sink writer) are legitimate fix shapes, unlike replace-shaped IAM
 * policies where any new binding is a privilege change (see
 * `validateGcpSetIamPolicy` and the bucket-IAM branch).
 */
export function validateGcpGenericPublicGrant(
  step: Pick<GcpStepInput, 'method' | 'url' | 'body' | 'queryParams'>,
  body: Record<string, unknown>,
  prefix: string,
  opts?: {
    isRollback?: boolean;
    realState?: Record<string, unknown>;
    readSteps?: GcpReadStepRef[];
    fixStep?: GcpStepIdentity;
  },
): string[] {
  if (
    bindingsGrantPublicAccess(body.bindings) ||
    datasetAccessGrantsPublicAccess(body.access) ||
    bodyGrantsPublicAccessDeep(body)
  ) {
    return [
      `${prefix}: granting access to the public (allUsers) exposes the resource — refused for safety`,
    ];
  }
  // A grant of owner/editor to a single address is the same escalation
  // under a narrower name — the public check alone misses it.
  if (
    bindingsGrantPrivilegedRole(body.bindings) ||
    datasetAccessGrantsPrivilegedRole(body.access) ||
    bodyGrantsPrivilegedRoleDeep(body)
  ) {
    return [
      `${prefix}: granting a privileged role (roles/owner, roles/editor) is an unreviewed privilege change — refused for safety`,
    ];
  }
  // A read- or edit-role grant to one address shares the dataset with exactly that
  // address — neither the public check nor the privileged-role check fires
  // on it. Adding access never fixes an exposure, so fix writes refuse;
  // rollback restores skip this refusal because prior-state comparison
  // (not the fix-flow gates) proves a restore equals the pre-fix value.
  if (!opts?.isRollback && bodyGrantsSinglePrincipalDataRoleDeep(body)) {
    return [
      `${prefix}: granting dataset read access to a single identity shares the dataset outside the fix — refused for safety`,
    ];
  }
  // An authorized view/dataset/routine entry shares the dataset with the
  // referenced resource's readers while carrying no `role` key, so every
  // gate above misses it. `access` is replace-shaped: a fix that removes
  // exposure resends the retained list, so entries already present in the
  // pre-fix state pass — only *new* shares refuse. Fail closed without
  // prior access: an unproven share is not safe. Rollback restores skip
  // this refusal like the single-principal gate above.
  if (!opts?.isRollback) {
    const shares = accessForeignShareEntries(body.access);
    if (shares.length > 0) {
      const priorAccess = findPriorStateValue(opts?.realState, 'access', {
        ...(opts?.readSteps ? { readSteps: opts.readSteps } : {}),
        ...(opts?.fixStep ? { fixStep: opts.fixStep } : {}),
      })?.value;
      const priorEntries = Array.isArray(priorAccess) ? priorAccess : [];
      const novel = shares.filter(
        (share) =>
          !priorEntries.some((prior) => isDeepStrictEqual(share, prior)),
      );
      if (novel.length > 0) {
        return [
          `${prefix}: sharing the dataset with another resource's readers (authorized view/dataset/routine) is a new share outside the fix — refused for safety`,
        ];
      }
    }
  }
  // Roles can also ride the effective query string (`queryParams` executes
  // on the wire exactly like URL query). Scan every effective value.
  for (const name of ['role', 'roles', 'member', 'members']) {
    for (const value of stepQueryParamValues(step, name)) {
      const normalized = value.trim().toLowerCase();
      if (
        normalized === 'allusers' ||
        normalized === 'allauthenticatedusers' ||
        GCP_NEVER_ALLOW_ROLES.some(
          (denied) => denied.toLowerCase() === normalized,
        )
      ) {
        return [
          `${prefix}: query param "${name}" grants public or privileged access — refused for safety`,
        ];
      }
    }
  }
  return [];
}
