/**
 * Storage/compute rollback-shape validators for AI-generated fix steps.
 * Visibility validators (detection off, log delivery emptied) live in
 * `remediation-visibility-validators`; both wire into fix-step validation
 * through `validateRollbackShape` in `remediation-rollback-guardrails`.
 * Split to respect the 300-line file limit — add new validators here.
 */

/**
 * S3 `PutBucketVersioning` is the fix API for unversioned buckets — the
 * fix only ever sets `Status` to `Enabled`. `Suspended` is the documented
 * rollback: it stops new recovery points while the plan reads like a fix.
 */
export function validatePutBucketVersioning(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const config = params.VersioningConfiguration;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return [];
  }
  const status = (config as Record<string, unknown>).Status;
  if (
    typeof status === 'string' &&
    status.trim().toLowerCase() === 'suspended'
  ) {
    return [
      `${prefix}: suspending versioning ("Suspended") stops new recovery points — refused for safety`,
    ];
  }
  return [];
}

/**
 * DynamoDB `UpdateContinuousBackups` is the fix API for missing PITR, and
 * the fix only ever enables it. Explicit false is the documented
 * rollback — it deletes the recovery window.
 */
export function validateUpdateContinuousBackups(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const spec = params.PointInTimeRecoverySpecification;
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return [];
  }
  if ((spec as Record<string, unknown>).PointInTimeRecoveryEnabled === false) {
    return [
      `${prefix}: explicitly disabling point-in-time recovery removes the recovery window — refused for safety`,
    ];
  }
  return [];
}

/**
 * ECR `PutImageTagMutability` is the fix API for mutable repos — the fix
 * only ever sets `IMMUTABLE`. Anything else (notably `MUTABLE`, the
 * documented rollback) re-opens tag overwriting.
 */
export function validatePutImageTagMutability(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const mutability = params.imageTagMutability;
  if (
    typeof mutability === 'string' &&
    mutability.trim().toLowerCase() !== 'immutable'
  ) {
    return [
      `${prefix}: image tag mutability must be "IMMUTABLE" — anything else re-opens tag overwriting — refused for safety`,
    ];
  }
  return [];
}

/**
 * EMR `SetTerminationProtection` is the fix API for unprotected clusters
 * — the fix only ever turns protection ON. Explicit false is the
 * documented rollback: it re-opens the cluster to one-click deletion.
 */
export function validateSetTerminationProtection(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  if (params.TerminationProtected === false) {
    return [
      `${prefix}: explicitly disabling termination protection re-opens the cluster to deletion — refused for safety`,
    ];
  }
  return [];
}

/**
 * SSM `UpdateServiceSetting` is never the documented fix and mutates
 * account-wide SSM behavior. Any value needs human review.
 */
export function validateUpdateServiceSetting(
  _params: Record<string, unknown>,
  prefix: string,
): string[] {
  return [
    `${prefix}: "UpdateServiceSetting" changes account-wide SSM behavior and is never the documented fix — refused for safety`,
  ];
}

/**
 * API Gateway `UpdateRoute` is the fix API for open routes — the fix only
 * ever attaches an authorizer (`JWT`, `AWS_IAM`, `CUSTOM`). `NONE` is the
 * documented rollback: it strips authentication while the plan reads like
 * a hardening step.
 */
export function validateUpdateRoute(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const authType = params.AuthorizationType;
  if (
    typeof authType === 'string' &&
    authType.trim().toLowerCase() === 'none'
  ) {
    return [
      `${prefix}: removing route authorization ("NONE") opens the route to unauthenticated callers — refused for safety`,
    ];
  }
  return [];
}
