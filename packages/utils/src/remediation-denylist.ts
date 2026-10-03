/**
 * Stop-the-bleeding denylist for AWS auto-remediation.
 *
 * Single source of truth for both the API (`apps/api`) and the web app
 * (`apps/app`). Both sides re-export this module — do NOT copy the lists.
 * The exact action list lives in `./remediation-blocked-actions` (split out
 * to respect the 300-line limit) and is re-exported below.
 *
 * The AI remediation flow can request arbitrary IAM actions and our UX
 * one-click-merges them onto the customer `OpenComp-Remediator` role via
 * `put-role-policy`. That self-expanding-permission loop must never grant:
 *
 * - privilege escalation (`iam:` writes / `PassRole`, `sts:AssumeRole`)
 * - monitoring kill-switches (`Disable`/`Delete`/`Stop` on detective controls,
 *   plus every `guardduty:Update*` — detector updates blind without a
 *   blocked verb)
 * - data-exfiltration vectors (`PutBucketPolicy`, `Put*Acl`, `Subscribe`, `PutPermission`)
 * - cost / destructive actions (`CreateSubscription`, `DeleteBackupPlan`, …)
 *
 * Anything listed here is excluded from generated fix scripts and surfaced
 * for manual review instead. Callers emit Allow-only policies for the
 * grantable bucket — never an explicit Deny, which would override a later
 * manual Allow granted by an admin in the AWS console.
 */

import { BLOCKED_REMEDIATION_ACTIONS } from './remediation-blocked-actions';

// Re-exported so existing import paths keep working — the API and the web app
// both import the list from this module, never from the actions file directly.
export { BLOCKED_REMEDIATION_ACTIONS } from './remediation-blocked-actions';

/** Lowercase mirror of the exact set — matching is case-insensitive. */
const BLOCKED_REMEDIATION_ACTIONS_LOWER: ReadonlySet<string> = new Set(
  [...BLOCKED_REMEDIATION_ACTIONS].map((action) => action.toLowerCase()),
);

/**
 * Action-name verbs (matched after the `service:` prefix) that are never
 * auto-granted. Catches the monitoring kill-switch family
 * (`StopLogging`, `DisableKeyRotation`, `DeleteDetector`, …), destructive
 * verbs (`ScheduleKeyDeletion`, `PurgeQueue`, `CloseAccount`,
 * `CancelSubscription`, `LeaveOrganization`, `RebootInstances`,
 * `SuspendDevices`, `DeactivatePipeline`), and network-opening writes
 * (`AuthorizeSecurityGroupIngress` — checks want groups closed, never
 * opened) without enumerating every service.
 *
 * `Revoke` is deliberately absent: `RevokeSecurityGroupIngress/Egress` close
 * offending rules, which IS the fix for open-group findings (the executor
 * validates those steps first-class). Revoking never opens access.
 */
const BLOCKED_REMEDIATION_VERBS =
  /^(Authorize|Delete|Disable|Stop|Remove|Terminate|Deregister|Unsubscribe|Schedule|Purge|Close|Cancel|Leave|Reboot|Suspend|Deactivate)/i;

/**
 * Detective-control updates that blind detection without a blocked verb.
 * GuardDuty `Update*` calls (`UpdateDetector` with `Enable: false`,
 * `UpdateMemberDetectors`, `UpdatePublishingDestination`, …) silently weaken
 * detection, and detector creation stays allowed via `CreateDetector` — so
 * every `guardduty:Update*` goes to manual review. Scoped to GuardDuty
 * only: sibling services (`cloudtrail:UpdateTrail`,
 * `config:PutConfigurationRecorder`) ARE fix mechanisms and stay allowed,
 * guarded per-parameter instead. The exact list names the known actions
 * explicitly for audit greppability; this rule backstops future additions.
 */
function isBlockedDetectiveUpdate(service: string, action: string): boolean {
  return service === 'guardduty' && action.startsWith('update');
}

/**
 * ACL-granting writes (`PutBucketAcl`, `PutObjectAcl`, …) expose data via
 * canned ACLs. Reads (`GetBucketAcl`) stay allowed — auditors need them.
 */
const BLOCKED_PUT_ACL_PATTERN = /^Put.*Acl$/i;

/** IAM reads that are always safe to auto-grant. Everything else `iam:` is not. */
const IAM_READ_PATTERN = /^(Get|List)/i;

/**
 * Well-formed `service:Action` tokens. Anything else — padding, quotes,
 * control characters, a missing separator, a wildcard service — is blocked.
 * IAM evaluates action names case-insensitively, so matching below is done
 * on the lowercased token; `IAM:PassRole` must hit the same rule as
 * `iam:PassRole`.
 */
const VALID_REMEDIATION_ACTION_TOKEN = /^[A-Za-z0-9-]+:[A-Za-z0-9*]+$/;

/**
 * Simple `service:Action` extractions without any gap — the keyword is
 * immediately followed by the token, so the pattern is linear (the `\s*`
 * separator is disjoint from the token charset and cannot backtrack).
 */
const NOT_AUTHORIZED_PATTERN = /not authorized to perform:\s*([\w:*-]+)/i;
const REQUIRED_PERMISSION_PATTERN = /required\s+([\w:*-]+)\s+permission/i;

/**
 * Token that follows a keyword within a bounded window. Both charsets are
 * disjoint from the `:` separator, so matching is linear in the window size.
 * The action slot must start uppercase: AWS emits canonical
 * `service:PascalCaseAction` tokens, so this skips ARN fragments (`arn:aws`)
 * and timestamps (`12:30`) and keeps scanning the window for the real action.
 */
const ACTION_TOKEN_PATTERN = /([\w-]+:[A-Z][\w*]*)/;

/** Cap error text before scanning so hostile inputs stay cheap. */
const MAX_ERROR_MESSAGE_LENGTH = 5000;
/** Max chars allowed between a keyword and its action token. */
const MAX_KEYWORD_GAP = 200;
/** Extra room after the gap for the `action:` prefix + token itself. */
const WINDOW_TAIL = 100;

/**
 * Finds the first `service:Action` token within `MAX_KEYWORD_GAP` chars after
 * a case-insensitive keyword. Implemented with `indexOf` + a small-window
 * regex instead of `keyword.{0,200}?token`: the dot-star overlaps the token
 * charset (`[\w-]`), which gives polynomial backtracking (ReDoS) on inputs
 * like `UnauthorizedAccess` + `-`.repeat(n). The windowed scan is linear.
 */
function extractAfterKeyword(
  message: string,
  lowerMessage: string,
  keyword: string,
  tokenPattern: RegExp,
): string | null {
  let fromIndex = 0;
  while (true) {
    const keywordIndex = lowerMessage.indexOf(keyword, fromIndex);
    if (keywordIndex === -1) {
      return null;
    }
    const windowStart = keywordIndex + keyword.length;
    const window = message.slice(windowStart, windowStart + MAX_KEYWORD_GAP + WINDOW_TAIL);
    const match = window.match(tokenPattern);
    // Preserve the original `.{0,200}?` gap semantics: the token must start
    // within MAX_KEYWORD_GAP chars of the keyword, not just anywhere in the
    // oversized window (the tail only leaves room for the token itself).
    if (match?.[1] && (match.index ?? 0) <= MAX_KEYWORD_GAP) {
      return match[1];
    }
    fromIndex = keywordIndex + keyword.length;
  }
}

/**
 * Canonical `service:Action` shape — the action slot starts uppercase.
 * Case-sensitive on purpose: AWS emits PascalCase actions, so anything else
 * reaching this check (ARN fragments, timestamps, bare words) is caller text
 * a pattern tripped over, not the missing permission. Deliberately stricter
 * than `isBlockedRemediationAction`, which stays case-insensitive for
 * human- and model-supplied input.
 */
const EXTRACTED_ACTION_TOKEN = /^[\w-]+:[A-Z][\w*]*$/;

/**
 * Extracts IAM `service:Action` tokens from an AWS error message.
 * Returns deduped actions in first-seen order, or `[]` when no pattern
 * matches. Used by the API fallback path, the central permission-error
 * parser, and the web client — all three must agree, so every new pattern
 * belongs here, not in a fourth copy.
 */
export function extractIamActionsFromErrorMessage(errorMessage: string): string[] {
  if (typeof errorMessage !== 'string' || errorMessage.length === 0) {
    return [];
  }
  // Cap the scan so a multi-MB caller-controlled message cannot force
  // proportional work. Real AWS errors are < 1KB.
  const message =
    errorMessage.length > MAX_ERROR_MESSAGE_LENGTH
      ? errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH)
      : errorMessage;
  const lowerMessage = message.toLowerCase();
  const actions: string[] = [];
  const seen = new Set<string>();
  const push = (action: string | null | undefined): void => {
    if (action && EXTRACTED_ACTION_TOKEN.test(action) && !seen.has(action)) {
      seen.add(action);
      actions.push(action);
    }
  };
  // "is not authorized to perform: iam:CreateServiceLinkedRole on resource"
  // "you do not have the required iam:CreateServiceLinkedRole permission"
  push(message.match(NOT_AUTHORIZED_PATTERN)?.[1]);
  push(message.match(REQUIRED_PERMISSION_PATTERN)?.[1]);
  // "Access Denied for action: s3:PutBucketEncryption". The token pattern
  // (uppercase action start) skips ARN fragments a `for:` prefix would
  // otherwise capture first — e.g. "Denied for arn:aws:iam::123:role/X"
  // must still resolve the real action that follows in the window.
  push(extractAfterKeyword(message, lowerMessage, 'denied', ACTION_TOKEN_PATTERN));
  // "UnauthorizedAccess: guardduty:CreateDetector". Service names can contain
  // hyphens (`cognito-idp`), so the service slot allows `-`.
  push(extractAfterKeyword(message, lowerMessage, 'unauthorizedaccess', ACTION_TOKEN_PATTERN));
  return actions;
}

/** Characters safe to render inside a `#`-comment line of a shell script. */
const DISPLAY_SAFE_ACTION_CHARS = /[^A-Za-z0-9:*_., +\-]/g;

/**
 * Returns true when an IAM action must never be granted via a generated
 * one-click remediation script. Fail-closed: malformed input and wildcards
 * (`s3:*`, `*:*`, bare `*`) are blocked — a script must name real actions.
 */
export function isBlockedRemediationAction(permission: string): boolean {
  if (typeof permission !== 'string') {
    return true;
  }
  const trimmed = permission.trim();
  if (!VALID_REMEDIATION_ACTION_TOKEN.test(trimmed)) {
    return true;
  }
  const normalized = trimmed.toLowerCase();
  if (BLOCKED_REMEDIATION_ACTIONS_LOWER.has(normalized)) {
    return true;
  }
  const separatorIndex = normalized.indexOf(':');
  const service = normalized.slice(0, separatorIndex);
  const action = normalized.slice(separatorIndex + 1);
  if (action.includes('*')) {
    return true;
  }
  if (isBlockedDetectiveUpdate(service, action)) {
    return true;
  }
  if (BLOCKED_REMEDIATION_VERBS.test(action)) {
    return true;
  }
  if (BLOCKED_PUT_ACL_PATTERN.test(action)) {
    return true;
  }
  if (service === 'iam' && !IAM_READ_PATTERN.test(action)) {
    return true;
  }
  // Role chaining from a one-click grant. `GetCallerIdentity` is harmless
  // (returns the caller's own identity) and stays allowed.
  if (service === 'sts' && action !== 'getcalleridentity') {
    return true;
  }
  return false;
}

/**
 * Splits a permission list into grantable vs manual-review buckets.
 * Deduplicates and sorts both outputs for stable scripts.
 */
export function splitBlockedRemediationActions(permissions: readonly string[]): {
  allowed: string[];
  blocked: string[];
} {
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const permission of new Set(permissions)) {
    if (isBlockedRemediationAction(permission)) {
      blocked.push(permission);
    } else {
      allowed.push(permission);
    }
  }
  allowed.sort();
  blocked.sort();
  return { allowed, blocked };
}

/**
 * Shell lines that merge actions into a role policy without wiping it.
 * Reads the FULL policy document so Deny statements, Conditions, and scoped
 * Resources survive — a bare replace deletes an admin manual Deny and widens
 * scoped Allows to "*". Scoped Allows stay verbatim; only plain "*" Allows
 * collapse into the merged statement. The `CUR` collector uses the exact
 * complement of the keep-scoped predicate below: an action collected from a
 * scoped Allow would be re-granted on "*" by the merged statement, silently
 * widening it. IAM has no conditional write, so concurrent runs are
 * last-writer-wins — the union keeps reruns idempotent, so re-run after a
 * concurrent change. `newVar` is the bare shell var name holding the JSON
 * action array. Callers emit ROLE/POLICY/assign lines first.
 */
export function rolePolicyMergeScriptLines(newVar: string): string[] {
  return [
    'DOC=$(aws iam get-role-policy --role-name "$ROLE" --policy-name "$POLICY" --query PolicyDocument --output json 2>/dev/null || echo \'{"Version":"2012-10-17","Statement":[]}\')',
    'CUR=$(echo "$DOC" | jq -c \'[.Statement // [] | .[] | select(.Effect=="Allow" and .Condition == null and ((.Resource | type) != "array") and (.Resource == null or .Resource == "*")) | .Action] | flatten | [.[] | strings]\' 2>/dev/null || echo \'[]\')',
    `MERGED=$(echo "$CUR $${newVar}" | jq -s '[.. | strings] | unique')`,
    'NEW_DOC=$(echo "$DOC" | jq --argjson merged "$MERGED" \'{Version: (.Version // "2012-10-17"), Statement: ([.Statement // [] | .[] | select(.Effect != "Allow")] + [.Statement // [] | .[] | select(.Effect == "Allow" and (.Condition != null or ((.Resource | type) == "array") or (.Resource != null and .Resource != "*")))] + [{Effect: "Allow", Action: $merged, Resource: "*"}])}\')',
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
