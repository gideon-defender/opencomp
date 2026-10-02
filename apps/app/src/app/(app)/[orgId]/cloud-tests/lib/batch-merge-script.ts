import {
  formatBlockedActionsForDisplay,
  rolePolicyMergeScriptLines,
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

function noGrantableComment(blocked: string[]): string {
  return `# No grantable permissions — every requested action (${blocked.length}) requires manual review and cannot be added via auto-fix: ${formatBlockedActionsForDisplay(blocked)}`;
}

function blockedWarning(blocked: string[]): string {
  return `# WARNING: excluded ${blocked.length} permission(s) requiring manual review: ${formatBlockedActionsForDisplay(blocked)}`;
}

/**
 * One-click script for a single finding's permissions. Merges with the FULL
 * live policy document so Deny statements, Conditions, and scoped Resources
 * survive (a bare replace would wipe an admin manual Deny). A stray Deny is
 * never merged back as granted permissions. Shared merge shape via the
 * helper — same as the per-banner script below and the backend scripts.
 */
export function buildFindingPermissionsScript(permissions: readonly string[]): BatchMergeScript {
  const { allowed: grantable, blocked } = splitBlockedRemediationActions(permissions);
  if (grantable.length === 0) {
    return { script: noGrantableComment(blocked), grantable, blocked };
  }
  const script = [
    ...(blocked.length > 0 ? [blockedWarning(blocked)] : []),
    'ROLE="OpenComp-Remediator" POLICY="OpenComp-BatchPermissions"',
    `NEW='${JSON.stringify(grantable)}'`,
    ...rolePolicyMergeScriptLines('NEW'),
  ].join('\n');
  return { script, grantable, blocked };
}

/**
 * Merge-safe script for the consolidated missing-permissions banner. Same
 * all-statements Allow merge as the per-finding script, with friendlier
 * inline comments for the multi-line CloudShell paste.
 */
export function buildMissingPermsMergeScript(permissions: readonly string[]): BatchMergeScript {
  const { allowed: grantable, blocked } = splitBlockedRemediationActions(permissions);
  if (grantable.length === 0) {
    return { script: noGrantableComment(blocked), grantable, blocked };
  }
  const script = [
    ...(blocked.length > 0 ? [blockedWarning(blocked)] : []),
    "# Merge new permissions with existing (won't overwrite Deny rules)",
    'ROLE="OpenComp-Remediator"',
    'POLICY="OpenComp-BatchPermissions"',
    `NEW_PERMS='${JSON.stringify(grantable)}'`,
    '',
    '# Read the full policy so Deny statements, Conditions, and scoped',
    "# Resources survive the merge (empty doc if the policy doesn't exist)",
    ...rolePolicyMergeScriptLines('NEW_PERMS'),
    '',
    'echo "Added $(echo $NEW_PERMS | jq length) permissions ($(echo $MERGED | jq length) total)"',
  ].join('\n');
  return { script, grantable, blocked };
}
