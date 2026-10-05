import {
  isSetIamPolicyUrl,
  parsedGcpUrl,
  stepLabel,
  stepQueryParamValues,
  type GcpStepInput,
} from './gcp-remediation-validator-shared';
import { validateGcpSetIamPolicy } from './gcp-remediation-iam-guardrails';
import { validateGcpComputePatch } from './gcp-remediation-compute-guardrails';
import {
  isFirewallInsert,
  isFirewallPath,
  validateGcpFirewallPatch,
} from './gcp-remediation-firewall-guardrails';
import {
  validateGcpSqlEndpointShape,
  validateGcpSqlPatch,
} from './gcp-remediation-sql-guardrails';
import {
  validateGcpBucketPatch,
  validateGcpStorageObjectUrl,
} from './gcp-remediation-bucket-guardrails';
import { validateGcpPubSubWrite } from './gcp-remediation-pubsub-guardrails';
import { validateGcpGenericPublicGrant } from './gcp-remediation-generic-grant-guardrails';
import {
  isProvisioningGuardedHost,
  validateGcpProvisioningWrite,
} from './gcp-remediation-provisioning-guardrails';
import type { GcpReadStepRef } from './gcp-remediation-prior-state';

/**
 * Parameter-level guardrails for AI-generated GCP fix steps.
 *
 * Mirrors `remediation-param-guardrails.ts` for AWS: the class allowlist
 * decides which *endpoints* may be called, but some allowlisted endpoints
 * are dual-use — one parameter value is the fix, another silently undoes a
 * security control. These checks reject only the dangerous parameter
 * shapes. Every rejection routes the plan to guided-only, never to
 * execution.
 *
 * Errors follow the `Step N (METHOD path): ...` convention so a future
 * AI-repair pass can attribute them to the right step.
 */

/**
 * Dispatch one write step to its parameter validators. Reads (GET) skip —
 * only writes carry dangerous shapes. `realState` is the read-step output
 * map when the plan was refined with live state; validators fail closed
 * (refuse) when the state they need is absent. Shared by the fix flow and
 * the rollback flow: a rollback that widens posture is an unreviewed
 * write, not a restore. `isRollback` marks the restore path — shapes that
 * are never fixes (provisioning) can still be sound restores, and the
 * rollback validators constrain those by prior-state comparison instead.
 */
export function validateGcpWriteStepParams(
  step: GcpStepInput,
  args: {
    realState?: Record<string, unknown>;
    readSteps?: GcpReadStepRef[];
    index: number;
    isRollback?: boolean;
  },
): string[] {
  if (step.method === 'GET') return [];
  const prefix = stepLabel({ method: step.method, url: step.url }, args.index);
  const body = step.body ?? {};
  const parsed = parsedGcpUrl(step.url);
  if (!parsed) {
    return [`${prefix}: URL is not parseable — refused for safety`];
  }
  // IAM first: a `:setIamPolicy` URL under a firewall path is still a
  // whole-policy replace and must face the removal-only check.
  if (isSetIamPolicyUrl(step.url)) {
    return validateGcpSetIamPolicy(body, args.realState, prefix, {
      ...(args.readSteps ? { readSteps: args.readSteps } : {}),
      fixStep: step,
    });
  }
  if (
    parsed.hostname === 'compute.googleapis.com' &&
    isFirewallPath(parsed.pathname)
  ) {
    return validateGcpFirewallPatch(
      body,
      prefix,
      isFirewallInsert(parsed.pathname, step.method),
      {
        ...(args.realState ? { realState: args.realState } : {}),
        ...(args.readSteps ? { readSteps: args.readSteps } : {}),
        fixStep: step,
        ...(step.method === 'PATCH' ? { isMerge: true } : {}),
        // PUT to a named path is a full replace (absent fields reset to
        // API defaults); PUT to the collection path is an insert, already
        // covered by isInsert above.
        ...(step.method === 'PUT' &&
        !isFirewallInsert(parsed.pathname, step.method)
          ? { isReplace: true }
          : {}),
      },
    );
  }
  // Non-firewall Compute: the allowlist prefix covers the whole Compute
  // API, so lifecycle/identity/targeting actions need an explicit gate —
  // otherwise `stop`, `setMetadata` (SSH keys), or `setTags` pass as fixes.
  if (parsed.hostname === 'compute.googleapis.com') {
    return validateGcpComputePatch({
      pathname: parsed.pathname,
      method: step.method,
      body,
      prefix,
    });
  }
  if (parsed.hostname === 'sqladmin.googleapis.com') {
    // Endpoint shape first: most sqladmin writes (export, user insert,
    // clone, failover) are never exposure fixes even with a benign body.
    const shapeErrors = validateGcpSqlEndpointShape({
      method: step.method,
      pathname: parsed.pathname,
      nameQueryValues: stepQueryParamValues(step, 'name'),
      body,
      prefix,
    });
    if (shapeErrors.length > 0) return shapeErrors;
    return validateGcpSqlPatch(body, args.realState, prefix, {
      ...(args.readSteps ? { readSteps: args.readSteps } : {}),
      fixStep: step,
    });
  }
  // Route on the normalized pathname (fixed-point decoded, dot-segments
  // resolved): the collection root normalizes to `/storage/v1/b` without a
  // trailing slash, so a trailing-slash `startsWith` alone would miss
  // `/storage/v1/b` and `/storage/v1/b/%2E` and drop creation-shaped writes
  // into the generic backstop, which reads them as allow.
  const storagePath = parsed.pathname.replace(/\/+$/, '');
  if (
    parsed.hostname === 'storage.googleapis.com' &&
    (parsed.pathname.startsWith('/storage/v1/b/') ||
      storagePath === '/storage/v1/b')
  ) {
    // Public-grant shapes first: pinned behavior names the exposure
    // (`.../o` object ACLs included), so refusal messages keep pointing
    // at it. Object writes that survive those checks still cannot fix a
    // bucket finding — the object guard refuses them as backstop.
    const bucketErrors = validateGcpBucketPatch(
      step,
      body,
      prefix,
      args.realState,
      {
        ...(args.readSteps ? { readSteps: args.readSteps } : {}),
        ...(args.isRollback ? { isRollback: true } : {}),
      },
    );
    if (bucketErrors.length > 0) return bucketErrors;
    return validateGcpStorageObjectUrl({
      pathname: parsed.pathname,
      method: step.method,
      body,
      prefix,
    });
  }
  // Hosts without a dedicated validator (KMS, DNS, monitoring,
  // BigQuery): creates are provisioning and deletes are destructive, so
  // they refuse here. PATCH repairs (dataset access removal, DNSSEC
  // enablement) stay allowed, but posture-weakening PATCH shapes refuse
  // here too — the generic grant gates below never fire on a PATCH that
  // carries no grant.
  if (isProvisioningGuardedHost(parsed.hostname)) {
    const provisioningErrors = validateGcpProvisioningWrite({
      method: step.method,
      prefix,
      hostname: parsed.hostname,
      body,
      ...(args.isRollback ? { isRollback: true } : {}),
    });
    if (provisioningErrors.length > 0) return provisioningErrors;
  }
  // Pub/Sub data-plane shapes (push redirect, publish injection) are not
  // grant-shaped, so the generic backstop below never fires on them — the
  // dedicated validator runs first, then grants still get their check.
  if (parsed.hostname === 'pubsub.googleapis.com') {
    const pubsubErrors = validateGcpPubSubWrite({
      method: step.method,
      pathname: parsed.pathname,
      body,
      ...(args.realState ? { realState: args.realState } : {}),
      ...(args.readSteps ? { readSteps: args.readSteps } : {}),
      fixStep: step,
      prefix,
      ...(args.isRollback ? { isRollback: true } : {}),
    });
    if (pubsubErrors.length > 0) return pubsubErrors;
  }
  return validateGcpGenericPublicGrant(step, body, prefix, {
    ...(args.isRollback ? { isRollback: true } : {}),
    ...(args.realState ? { realState: args.realState } : {}),
    ...(args.readSteps ? { readSteps: args.readSteps } : {}),
    fixStep: step,
  });
}
