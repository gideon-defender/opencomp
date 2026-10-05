import {
  buildRemediationGrantScript,
  splitBlockedRemediationActions,
} from './remediation-denylist';

export interface BatchMergeScript {
  /** Runnable grant script, or null when the finding's pair role is unknown (render manual guidance instead). */
  script: string | null;
  grantable: string[];
  blocked: string[];
}

/** Prefix shared by generated guidance-only scripts (no executable command). */
export const NO_GRANTABLE_PREFIX = '# No grantable permissions';

/**
 * True when the script is manual-review guidance rather than a command to
 * run. A runnable script always carries at least one `aws ...` command
 * line — every backend guidance comment ("No grantable permissions",
 * "Could not determine the missing IAM action", "WARNING: ... cannot be
 * added via auto-fix" with no grantable remainder) is comment-only, so the
 * absence of an `aws ` line is the robust discriminator across current and
 * future guidance wordings. Service-linked-role commands start with
 * `aws ` and correctly read as runnable.
 */
export function isGuidanceOnlyScript(script: string | null): boolean {
  if (!script) return false;
  if (script.startsWith(NO_GRANTABLE_PREFIX)) return true;
  return !script.split('\n').some((line) => line.trimStart().startsWith('aws '));
}

function batchWarningLine({ count, display }: { count: number; display: string }): string {
  return `# WARNING: excluded ${count} permission(s) requiring manual review: ${display}`;
}

/**
 * One-click script for a single finding's permissions. Merges with the FULL
 * live policy document so Deny statements, Conditions, and scoped Resources
 * survive (a bare replace would wipe an admin manual Deny). A stray Deny is
 * never merged back as granted permissions. Shared merge shape via the
 * helper — same as the per-banner script below and the backend scripts.
 *
 * Pass the finding's routed pair role name (`OpenComp-Remediator-…`) so
 * the grant lands on the role the server reads. Unknown routing yields a
 * null script — render manual guidance instead of a grant onto a role
 * that may not exist.
 */
export function buildFindingPermissionsScript(
  permissions: readonly string[],
  roleName?: string,
): BatchMergeScript {
  const { allowed: grantable, blocked } = splitBlockedRemediationActions(permissions);
  if (!roleName) return { script: null, grantable, blocked };
  return {
    script: buildRemediationGrantScript({
      permissions,
      policyName: 'OpenComp-BatchPermissions',
      roleName,
      warningLine: batchWarningLine,
    }),
    grantable,
    blocked,
  };
}
