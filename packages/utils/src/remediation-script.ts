import { splitBlockedRemediationActions } from './remediation-denylist';

/**
 * One-click IAM grant script builder shared by the API and the web app.
 *
 * Single place that assembles the `ROLE/POLICY` header, the JSON action
 * variable, and the read-merge-write lines (`rolePolicyMergeScriptLines`).
 * Before this helper the backend static builder, the AI-service inline
 * assembly, and the two frontend batch builders each hand-rolled the same
 * shape with different policy names and variable names — a merge-logic fix
 * had to land in four places. Callers pass their policy/variable names and
 * any custom comment lines; the split, the Allow-only merge, and the
 * never-Deny invariant stay here.
 */
export interface RemediationGrantScriptOptions {
  /** Requested actions — split into grantable vs manual-review here. */
  permissions: readonly string[];
  /** Policy to write, e.g. `OpenComp-AutoFix` or `OpenComp-BatchPermissions`. */
  policyName?: string;
  roleName?: string;
  /** Shell variable holding the JSON action array. */
  variableName?: string;
  /** Warning prepended when some actions need manual review. */
  warningLine?: (args: { count: number; display: string }) => string;
  /** Whole script when nothing is grantable (comment-only, runs nothing). */
  emptyLine?: (args: { count: number; display: string }) => string;
  /** Replaces the default single `ROLE=".." POLICY=".."` line. */
  roleHeaderLines?: string[];
  /** Comment lines between the warning and the role header. */
  extraHeaderLines?: string[];
  /** Lines between the variable assignment and the merge block. */
  preMergeLines?: string[];
  /** Lines after the merge block (e.g. an `echo` summary). */
  postMergeLines?: string[];
}

const DEFAULT_POLICY_NAME = 'OpenComp-AutoFix';
const DEFAULT_ROLE_NAME = 'OpenComp-Remediator';
const DEFAULT_VARIABLE_NAME = 'NEW';

function defaultWarningLine({ count, display }: { count: number; display: string }): string {
  return `# WARNING: ${count} requested permission(s) require manual review and were NOT granted: ${display}`;
}

function defaultEmptyLine({ count, display }: { count: number; display: string }): string {
  return `# No grantable permissions — every requested action (${count}) requires manual review and cannot be added via auto-fix: ${display}`;
}

/**
 * Build a permission-grant script. Emits Allow-only for the grantable
 * bucket. Blocked actions (denylist) are omitted — never an explicit Deny,
 * which would override a later manual Allow granted by an admin in the
 * console. Read-merge-write against the FULL policy document: Deny
 * statements, Conditions, and scoped Resources survive the merge (a bare
 * put-role-policy would replace the whole policy and wipe them).
 */
export function buildRemediationGrantScript(options: RemediationGrantScriptOptions): string {
  const {
    permissions,
    policyName = DEFAULT_POLICY_NAME,
    roleName = DEFAULT_ROLE_NAME,
    variableName = DEFAULT_VARIABLE_NAME,
    warningLine = defaultWarningLine,
    emptyLine = defaultEmptyLine,
    roleHeaderLines,
    extraHeaderLines = [],
    preMergeLines = [],
    postMergeLines = [],
  } = options;
  const { allowed, blocked } = splitBlockedRemediationActions(permissions);
  const display = formatBlockedActionsForDisplay(blocked);
  if (allowed.length === 0) {
    return emptyLine({ count: blocked.length, display });
  }
  return [
    ...(blocked.length > 0 ? [warningLine({ count: blocked.length, display })] : []),
    ...extraHeaderLines,
    ...(roleHeaderLines ?? [`ROLE="${roleName}" POLICY="${policyName}"`]),
    `${variableName}='${JSON.stringify(allowed)}'`,
    ...preMergeLines,
    ...rolePolicyMergeScriptLines(variableName),
    ...postMergeLines,
  ].join('\n');
}

/** Characters safe to render inside a `#`-comment line of a shell script. */
const DISPLAY_SAFE_ACTION_CHARS = /[^A-Za-z0-9:*_., +\-]/g;

/**
 * Shell lines that merge actions into a role policy without wiping it.
 * Reads the FULL policy document so Deny statements, Conditions, and scoped
 * Resources survive — a bare replace deletes an admin manual Deny and widens
 * scoped Allows to "*". Scoped Allows stay verbatim; only plain "*" Allows
 * collapse into the merged statement. `NotAction`/`NotResource` statements
 * also pass through verbatim — their inverted match cannot be represented in
 * the merged statement, so collecting them would widen or drop the carve-out.
 * The `CUR` collector is the exact complement of the keep-scoped predicate:
 * a collected scoped action would be re-granted on "*" by the merge. IAM has
 * no conditional write (last-writer-wins) — re-run after a concurrent change.
 * `newVar` is the shell var holding the JSON action array.
 */
export function rolePolicyMergeScriptLines(newVar: string): string[] {
  return [
    'DOC=$(aws iam get-role-policy --role-name "$ROLE" --policy-name "$POLICY" --query PolicyDocument --output json 2>/dev/null || echo \'{"Version":"2012-10-17","Statement":[]}\')',
    'CUR=$(echo "$DOC" | jq -c \'[.Statement // [] | .[] | select(.Effect=="Allow" and .Condition == null and .NotAction == null and .NotResource == null and ((.Resource | type) != "array") and (.Resource == null or .Resource == "*")) | .Action] | flatten | [.[] | strings]\' 2>/dev/null || echo \'[]\')',
    `MERGED=$(echo "$CUR $${newVar}" | jq -s '[.. | strings] | unique')`,
    'NEW_DOC=$(echo "$DOC" | jq --argjson merged "$MERGED" \'{Version: (.Version // "2012-10-17"), Statement: ([.Statement // [] | .[] | select(.Effect != "Allow")] + [.Statement // [] | .[] | select(.Effect == "Allow" and ((.Condition != null or .NotAction != null or .NotResource != null) or ((.Resource | type) == "array") or (.Resource != null and .Resource != "*")))] + [{Effect: "Allow", Action: $merged, Resource: "*"}])}\')',
    'aws iam put-role-policy --role-name "$ROLE" --policy-name "$POLICY" --policy-document "$NEW_DOC"',
  ];
}

/**
 * Renders blocked actions for `# WARNING` comments, log lines, and UI text.
 * Blocked tokens can carry attacker-shaped content (quotes, newlines from a
 * fooled model), so anything outside the display-safe charset becomes `?`
 * and long tokens are truncated. Canonical action names pass through
 * unchanged.
 */
export function formatBlockedActionsForDisplay(blocked: readonly string[]): string {
  return blocked
    .map((action) =>
      (typeof action === 'string' ? action : String(action))
        .replace(DISPLAY_SAFE_ACTION_CHARS, '?')
        .slice(0, 120),
    )
    .join(', ');
}
