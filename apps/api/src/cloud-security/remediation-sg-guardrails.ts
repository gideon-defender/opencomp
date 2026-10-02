import type { AwsCommandStep } from './ai-remediation.prompt';

/**
 * Parameter-level guardrails for security-group rule changes.
 *
 * Authorize and Revoke on security groups are dual-use by construction:
 * Revoke closes the offending open rule (the fix for open-group findings),
 * but Authorize with an open CIDR re-opens the group to the world while the
 * plan description still reads like an improvement. The IAM denylist cannot
 * cover this — the action itself must stay granted for the legitimate
 * restricted-CIDR fix — so these checks refuse only the dangerous shapes.
 *
 * Errors follow the `Step N (Command): ...` convention from
 * `validatePlanSteps` so the AI-repair pass can attribute them to the right
 * step. Every rejection routes the plan to manual steps — never to execution.
 */

const REVOKE_SECURITY_GROUP_RULE_PROPERTY_PARAMS = [
  'CidrIp',
  'FromPort',
  'IpPermissions',
  'IpProtocol',
  'SourceSecurityGroupName',
  'SourceSecurityGroupOwnerId',
  'ToPort',
] as const;

/** An open ingress/egress grant is never the fix — it is the finding. */
const OPEN_IPV4_CIDR = '0.0.0.0/0';
const OPEN_IPV6_CIDR = '::/0';

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function ipPermissionsOf(
  params: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const perms = params.IpPermissions;
  if (!Array.isArray(perms)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const perm of perms) {
    const record = asRecord(perm);
    if (record) out.push(record);
  }
  return out;
}

function rangeListsOf(perm: Record<string, unknown>): unknown[] {
  const lists: unknown[] = [];
  // EC2 spells the v6 key `Ipv6Ranges` (lowercase v); accept both casings
  // so a model emitting the conventional spelling is still inspected.
  for (const key of ['IpRanges', 'Ipv6Ranges', 'IPv6Ranges']) {
    const list: unknown = perm[key];
    if (!Array.isArray(list)) continue;
    for (const item of list as unknown[]) lists.push(item);
  }
  return lists;
}

function isOpenCidrRange(range: unknown): boolean {
  const record = asRecord(range);
  if (!record) return false;
  for (const key of ['CidrIp', 'CidrIpv6']) {
    const cidr = record[key];
    if (typeof cidr !== 'string') continue;
    const normalized = cidr.trim();
    if (normalized === OPEN_IPV4_CIDR || normalized === OPEN_IPV6_CIDR) {
      return true;
    }
  }
  return false;
}

/**
 * Refuse Authorize steps that grant the world access. Restricted CIDRs pass
 * — replacing an open rule with a restricted one IS the documented fix — but
 * `0.0.0.0/0` / `::/0` reintroduces the finding while the plan reads like an
 * improvement. Applies to ingress and egress alike: opening egress to the
 * world is never a hardening fix.
 */
export function validateAuthorizeSecurityGroupParams(
  step: AwsCommandStep,
  prefix: string,
): string[] {
  const params = asRecord(step.params) ?? {};
  for (const perm of ipPermissionsOf(params)) {
    if (rangeListsOf(perm).some(isOpenCidrRange)) {
      return [
        `${prefix}: granting access to "${OPEN_IPV4_CIDR}" or "${OPEN_IPV6_CIDR}" opens the group to the world — refused for safety; use restricted CidrIp values`,
      ];
    }
  }
  // EC2 also accepts the single-rule shorthand with top-level CidrIp /
  // CidrIpv6 (no IpPermissions array). A step carrying the open CIDR there
  // executes the same world-open grant, so it clears the same bar.
  // Reuse the range check on a synthetic record — it only reads the two
  // CIDR keys and ignores anything else on the params object.
  if (isOpenCidrRange(params)) {
    return [
      `${prefix}: granting access to "${OPEN_IPV4_CIDR}" or "${OPEN_IPV6_CIDR}" opens the group to the world — refused for safety; use restricted CidrIp values`,
    ];
  }
  return [];
}

function validateRevokeSecurityGroupShape(
  step: AwsCommandStep,
  prefix: string,
): string[] {
  const params = asRecord(step.params) ?? {};
  const hasGroupIdentifier =
    hasValue(params.GroupId) || hasValue(params.GroupName);
  const hasRuleIds = hasValue(params.SecurityGroupRuleIds);
  const hasRuleProperties = REVOKE_SECURITY_GROUP_RULE_PROPERTY_PARAMS.some(
    (key) => hasValue(params[key]),
  );

  if (!hasRuleIds && !hasRuleProperties) {
    return [
      `${prefix}: One of "SecurityGroupRuleIds" or rule property params is required`,
    ];
  }

  if (hasRuleIds && hasRuleProperties) {
    return [
      `${prefix}: SecurityGroupRuleIds cannot be combined with rule property params`,
    ];
  }

  if (hasRuleIds && !hasRuleProperties) return [];
  if (hasGroupIdentifier) return [];

  return [`${prefix}: One of "GroupId" or "GroupName" is required`];
}

/**
 * Revoke closes the offending rule, which IS the fix for open-group
 * findings — including revoking an open CIDR. Only the step shape is
 * validated here (rule ids xor rule properties, group identifier present),
 * never the CIDR value: refusing the open CIDR would block the close.
 */
export function validateRevokeSecurityGroupIngressParams(
  step: AwsCommandStep,
  prefix: string,
): string[] {
  return validateRevokeSecurityGroupShape(step, prefix);
}

/**
 * Same shape validation as ingress. Revoking an open egress rule is the
 * legitimate close for an open-egress finding, so — like ingress — the CIDR
 * value itself is never refused, only a malformed step.
 */
export function validateRevokeSecurityGroupEgressParams(
  step: AwsCommandStep,
  prefix: string,
): string[] {
  return validateRevokeSecurityGroupShape(step, prefix);
}
