import {
  buildRemediationGrantScript,
  splitBlockedRemediationActions,
} from './remediation-denylist';

export interface BatchMergeScript {
  script: string;
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
 * Pass the finding's routed pair role name (`OpenComp-Remediator-…`) when
 * known so the grant lands on the role the server reads; legacy monolith
 * default preserves old behavior when routing is unknown.
 */
export function buildFindingPermissionsScript(
  permissions: readonly string[],
  roleName?: string,
): BatchMergeScript {
  const { allowed: grantable, blocked } = splitBlockedRemediationActions(permissions);
  return {
    script: buildRemediationGrantScript({
      permissions,
      policyName: 'OpenComp-BatchPermissions',
      ...(roleName ? { roleName } : {}),
      warningLine: batchWarningLine,
    }),
    grantable,
    blocked,
  };
}

/**
 * Merge-safe script for the consolidated missing-permissions banner. Same
 * all-statements Allow merge as the per-finding script, with friendlier
 * inline comments for the multi-line CloudShell paste.
 */
export function buildMissingPermsMergeScript(
  permissions: readonly string[],
  roleName = 'OpenComp-Remediator',
): BatchMergeScript {
  const { allowed: grantable, blocked } = splitBlockedRemediationActions(permissions);
  return {
    script: buildRemediationGrantScript({
      permissions,
      variableName: 'NEW_PERMS',
      warningLine: batchWarningLine,
      extraHeaderLines: ["# Merge new permissions with existing (won't overwrite Deny rules)"],
      roleHeaderLines: [`ROLE="${roleName}"`, 'POLICY="OpenComp-BatchPermissions"'],
      preMergeLines: [
        '',
        '# Read the full policy so Deny statements, Conditions, and scoped',
        "# Resources survive the merge (empty doc if the policy doesn't exist)",
      ],
      postMergeLines: [
        '',
        'echo "Added $(echo $NEW_PERMS | jq length) permissions ($(echo $MERGED | jq length) total)"',
      ],
    }),
    grantable,
    blocked,
  };
}
