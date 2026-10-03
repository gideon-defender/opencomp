/**
 * IAM action coverage helpers for the remediation role read.
 *
 * `RemediationService.getExistingRolePermissions` collects the union of
 * allowed actions from inline + attached-managed policies and then
 * subtracts explicit denies. Both directions need real IAM semantics:
 * action names match case-insensitively, `*` matches any sequence and `?`
 * matches any single character, so `s3:Get*` (allow or deny) covers
 * `s3:GetObject`. Exact-string comparison gets both wrong — a
 * partial-wildcard deny would read as uncovered (UI says "ready",
 * execution fails) and a partial-wildcard grant would read
 * as missing (needless fix script).
 *
 * Deny handling runs in two layers. `subtractDeniedActions` prunes allow
 * entries a deny pattern fully covers (exact or broader denies). That
 * pattern-against-pattern pass cannot see the reverse case — a specific
 * deny (`s3:GetObject`) against a wildcard allow (`s3:*`) — so
 * `isPermissionCoveredBySet` takes the deny set too and re-checks every
 * deny pattern against the concrete required action at query time.
 * Explicit deny always wins, exactly like IAM. `NotAction` statements are
 * handled fail-closed: `Deny` + `NotAction` denies everything except the
 * listed actions, so it records a broad deny rather than zero entries
 * (which would falsely report "ready").
 *
 * Pure functions, tested in `remediation-permission-coverage.spec.ts`.
 * Patterns here come from the customer's own IAM policies (admin-written,
 * IAM length-bounded), never from model output.
 */

/** Escape RegExp syntax so only `*` stays special in the matcher below. */
function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when an IAM action matches a granted/denied pattern.
 * Case-insensitive; `*` matches any (possibly empty) sequence and `?`
 * matches any single character, mirroring IAM. `s3:Get*` matches
 * `s3:GetObject` but not `s3:PutObject`; `s3:Get?bject` matches
 * `s3:GetObject`.
 */
export function iamActionPatternMatches(
  pattern: string,
  action: string,
): boolean {
  const lowerPattern = pattern.toLowerCase();
  const lowerAction = action.toLowerCase();
  if (!lowerPattern.includes('*') && !lowerPattern.includes('?')) {
    return lowerPattern === lowerAction;
  }
  let regexSource = '';
  for (const char of lowerPattern) {
    if (char === '*') {
      regexSource += '.*';
    } else if (char === '?') {
      regexSource += '.';
    } else {
      regexSource += escapeRegExpLiteral(char);
    }
  }
  const regex = new RegExp(`^${regexSource}$`);
  return regex.test(lowerAction);
}

/**
 * Coarse prune: remove allow entries a deny pattern fully covers (exact or
 * broader denies). `*` or `*:*` denies everything. Mutates `allowed` in
 * place. This pass cannot catch a specific deny against a wildcard allow —
 * callers must also pass `denied` to `isPermissionCoveredBySet`.
 */
export function subtractDeniedActions(
  allowed: Set<string>,
  denied: Set<string>,
): void {
  if (denied.has('*') || denied.has('*:*')) {
    allowed.clear();
    return;
  }
  for (const deny of denied) {
    for (const action of [...allowed]) {
      if (iamActionPatternMatches(deny, action)) {
        allowed.delete(action);
      }
    }
  }
}

/**
 * True when a granted action covers the required permission — exact,
 * service-wildcard (`s3:*`), or partial-wildcard (`s3:Get*`) grants —
 * and no deny pattern matches the required action. The deny check runs
 * against the concrete required action (not the allow patterns), so a
 * specific deny (`s3:GetObject`) defeats a wildcard allow (`s3:*`).
 */
export function isPermissionCoveredBySet(
  required: string,
  existing: Set<string>,
  denied: Set<string> = new Set<string>(),
): boolean {
  for (const deny of denied) {
    if (iamActionPatternMatches(deny, required)) {
      return false;
    }
  }
  for (const granted of existing) {
    if (iamActionPatternMatches(granted, required)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize an IAM policy document's `Statement` to an array. IAM allows a
 * single statement object, and console-saved single-statement policies use
 * exactly that shape — treating it as zero statements reports every
 * permission as missing.
 */
export function normalizePolicyStatements(doc: unknown): Array<{
  Effect?: string;
  Action?: string | string[];
  NotAction?: string | string[];
}> {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
  const statement = (doc as { Statement?: unknown }).Statement;
  if (!statement) return [];
  if (Array.isArray(statement)) {
    return statement.filter(
      (
        s,
      ): s is {
        Effect?: string;
        Action?: string | string[];
        NotAction?: string | string[];
      } => Boolean(s) && typeof s === 'object' && !Array.isArray(s),
    );
  }
  if (typeof statement === 'object') {
    return [statement];
  }
  return [];
}

/**
 * Paginated IAM reads behind the remediation role scan. Implemented by the
 * service with real SDK calls; faked in tests. Page markers are opaque —
 * pass back whatever the previous call returned.
 */
export interface RolePolicyReader {
  listInlinePolicyNames(params: {
    roleName: string;
    marker?: string;
  }): Promise<{ names: string[]; marker?: string }>;
  getInlinePolicyDocument(params: {
    roleName: string;
    policyName: string;
  }): Promise<unknown>;
  listAttachedPolicies(params: { roleName: string; marker?: string }): Promise<{
    policies: Array<{ arn?: string; name?: string }>;
    marker?: string;
  }>;
  getAttachedPolicyDocument(policyArn: string): Promise<unknown>;
}

function collectStatementActions(
  doc: unknown,
  allowed: Set<string>,
  denied: Set<string>,
): void {
  for (const stmt of normalizePolicyStatements(doc)) {
    const notActions = Array.isArray(stmt.NotAction)
      ? stmt.NotAction
      : [stmt.NotAction];
    // `NotAction` inverts the match: `Deny` + `NotAction` denies everything
    // except the listed actions (a common guardrail shape). Treating the
    // statement as zero entries would report the role "ready" while IAM
    // denies execution, so a deny with `NotAction` is recorded as a broad
    // deny — fail-closed to manual review. An `Allow` + `NotAction` grants
    // everything-except and can never prove a concrete action is covered,
    // so it contributes nothing either way.
    if (notActions.some((action) => typeof action === 'string')) {
      if (stmt.Effect === 'Deny') {
        denied.add('*');
      }
      continue;
    }
    const stmtActions = Array.isArray(stmt.Action)
      ? stmt.Action
      : [stmt.Action];
    for (const action of stmtActions) {
      if (typeof action !== 'string') continue;
      if (stmt.Effect === 'Deny') {
        denied.add(action);
      } else if (stmt.Effect === 'Allow') {
        allowed.add(action);
      }
    }
  }
}

/**
 * Read the union of allowed actions on a role across every page of inline
 * policies plus every page of attached managed policies, with explicit
 * denies collected alongside (callers apply `subtractDeniedActions`).
 * A single unreadable policy warns through `onError` and is skipped — one
 * bad document must not blank the whole read.
 */
export async function readRolePermissionSets(
  reader: RolePolicyReader,
  roleName: string,
  onError: (message: string) => void,
): Promise<{ allowed: Set<string>; denied: Set<string> }> {
  const allowed = new Set<string>();
  const denied = new Set<string>();
  // Any unread policy may hide an explicit Deny — a partial denied set
  // fails open ("ready" while IAM denies), so a read failure degrades to
  // deny-everything. An incomplete allowed set already fails closed.
  let hadReadError = false;

  let marker: string | undefined;
  do {
    const page = await reader.listInlinePolicyNames({ roleName, marker });
    for (const policyName of page.names) {
      try {
        const doc = await reader.getInlinePolicyDocument({
          roleName,
          policyName,
        });
        collectStatementActions(doc, allowed, denied);
      } catch (err) {
        hadReadError = true;
        onError(
          `Failed to read policy ${policyName}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    marker = page.marker;
  } while (marker);

  let attachedMarker: string | undefined;
  do {
    const page = await reader.listAttachedPolicies({
      roleName,
      marker: attachedMarker,
    });
    for (const policy of page.policies) {
      if (!policy.arn) {
        hadReadError = true;
        onError(`Attached policy on ${roleName} is missing its ARN`);
        continue;
      }
      try {
        const doc = await reader.getAttachedPolicyDocument(policy.arn);
        collectStatementActions(doc, allowed, denied);
      } catch (err) {
        hadReadError = true;
        onError(
          `Failed to read attached policy ${policy.arn}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    attachedMarker = page.marker;
  } while (attachedMarker);

  if (hadReadError) {
    denied.add('*');
  }
  return { allowed, denied };
}
