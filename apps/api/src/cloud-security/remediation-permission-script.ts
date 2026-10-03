import { buildRemediationGrantScript } from './remediation-denylist';

/** Shown wherever blocked actions are surfaced for manual review. */
export const BLOCKED_PERMISSIONS_MESSAGE =
  'These permissions require manual review and cannot be granted via auto-fix. Add them in the AWS console only if you understand the impact.';

/**
 * Build a permission script. Emits Allow-only for the grantable bucket.
 * Blocked actions (denylist) are omitted — never an explicit Deny, which
 * would override a later manual Allow granted by an admin in the console.
 * Read-merge-write against the FULL policy document: Deny statements,
 * Conditions, and scoped Resources survive the merge (a bare put-role-policy
 * would replace the whole policy and wipe them). Same merge shape as the
 * frontend batch scripts, via the shared helper.
 */
export function buildStaticPermissionScript(permissions: string[]): string {
  return buildRemediationGrantScript({
    permissions,
    policyName: 'OpenComp-AutoFix',
  });
}
