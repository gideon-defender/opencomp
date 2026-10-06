import { isDeepStrictEqual } from 'node:util';
import {
  asRecord,
  bindingsGrantPublicAccess,
  isPublicAclEntry,
  isPublicPredefinedAcl,
  parsedGcpUrl,
  stepQueryParamValues,
} from './gcp-remediation-validator-shared';
import {
  findPriorPolicyForUrl,
  findPriorStateValue,
  type GcpReadStepRef,
} from './gcp-remediation-prior-state';
import { validateGcpBucketRetentionPolicy } from './gcp-remediation-bucket-retention-guardrails';
import type { GcpStepInput } from './gcp-remediation-step-url';

/**
 * Bucket parameter guardrails for AI-generated GCP fix steps.
 *
 * Split from `gcp-remediation-param-guardrails` to respect the 300-line
 * repo limit. Every rejection routes the plan to guided-only, never to
 * execution.
 */

function bindingsSubsetOfPrior(args: {
  next: unknown;
  prior: Record<string, unknown> | undefined;
}): boolean {
  // Malformed (non-array) bindings fail closed: an unknown shape must
  // refuse, never read as "nothing new granted".
  if (!Array.isArray(args.next)) return false;
  if (!args.prior) return false;
  const priorBindings = Array.isArray(args.prior.bindings)
    ? args.prior.bindings
    : [];
  return (args.next as unknown[]).every((binding) =>
    priorBindings.some((priorBinding) =>
      isDeepStrictEqual(priorBinding, binding),
    ),
  );
}

/**
 * Storage object and ACL-endpoint routing lives in
 * `gcp-remediation-bucket-object-guardrails`, and retention-policy
 * durability lives in `gcp-remediation-bucket-retention-guardrails`
 * (both split for the 300-line repo limit).
 */

// Re-exported here so `gcp-remediation-bucket-guardrails` stays the single
// import path.
export { validateGcpStorageObjectUrl } from './gcp-remediation-bucket-object-guardrails';

/**
 * Bucket writes must not weaken access posture: refuse downgrading
 * `publicAccessPrevention` to `inherited`, disabling uniform
 * bucket-level access, public ACL grants (`allUsers`), public IAM
 * `bindings` grants (`members: ["allUsers"]` via `PUT .../iam`), and
 * public canned-ACL query params (`predefinedAcl` and
 * `predefinedDefaultObjectAcl`). Query params execute from both
 * the raw URL and `queryParams`, so a benign value in one source does
 * not excuse a public value in the other.
 *
 * Member grants face the same removal-only rule as `setIamPolicy`: when
 * prior state is available, every new binding must already exist there —
 * a grant to a fresh principal is an unreviewed privilege change, not a
 * fix. Without prior state, any `bindings` write is refused outright.
 */
export function validateGcpBucketPatch(
  step: Pick<GcpStepInput, 'method' | 'url' | 'queryParams'>,
  body: Record<string, unknown>,
  prefix: string,
  realState?: Record<string, unknown>,
  opts?: {
    readSteps?: GcpReadStepRef[];
    // Restore path: rollback PUTs prove themselves by prior-state
    // comparison in the rollback validators (updateMask + per-field
    // equality), so the replace-shaped PUT refusal below applies to the
    // fix flow only.
    isRollback?: boolean;
  },
): string[] {
  const errors: string[] = [];
  // Bucket creation (`POST /storage/v1/b/?project=<id>`) provisions a new
  // bucket — never a fix for an existing finding's exposure. The bare
  // collection path names no bucket, so no write to it can narrow one:
  // refuse before the shape checks below, which all read as allow on a
  // creation body (`{name: ...}` weakens nothing and grants nothing).
  // Reads stay out of this function (the dispatcher skips GET first), so a
  // missing method reads as a write and fails closed. Bucket deletion is
  // never a fix either: creation is refused, so no fix can create a bucket
  // whose deletion would be a sound rollback — a DELETE here destroys a
  // pre-existing bucket (the executor permits DELETE on rollback).
  if (step.method === 'DELETE') {
    return [
      `${prefix}: deleting a bucket destroys data — never a finding fix — refused for safety`,
    ];
  }
  // Normalized once for the shape gates below: the same string the
  // dispatcher routes on (fixed-point decoded, dot-segments resolved).
  const bucketPath = parsedGcpUrl(step.url)?.pathname.replace(/\/+$/, '') ?? '';
  // `PUT` on the bucket resource replaces the whole metadata object while
  // every durability check below reads absence as "unchanged" — true for
  // PATCH merge, false for PUT replace. A sparse PUT silently resets the
  // protections it omits, so metadata fixes use PATCH and PUT routes to
  // guided-only. Fix flow only: rollback PUTs carry updateMask and prove
  // each restored field against prior state in the rollback validators.
  // Scoped to the bare bucket path: the IAM path keeps PUT
  // (its bindings/etag gates already demand the full policy) and object
  // paths keep their own backstop.
  if (
    step.method === 'PUT' &&
    !opts?.isRollback &&
    /^\/storage\/v1\/b\/[^/]+$/.test(bucketPath)
  ) {
    return [
      `${prefix}: PUT replaces the whole bucket resource — a sparse body resets the fields it omits — use PATCH instead — refused for safety`,
    ];
  }
  if (step.method !== 'GET') {
    // Match on the normalized pathname (fixed-point decoded, dot-segments
    // resolved) — the same string the dispatcher routes on — so an encoded
    // collection root (`/storage/v1/b/%2E`) cannot dodge this check while
    // still routing here.
    const normalized = parsedGcpUrl(step.url)?.pathname.replace(/\/+$/, '');
    if (normalized === '/storage/v1/b') {
      return [
        `${prefix}: creating a bucket provisions a new resource — never a finding fix — refused for safety`,
      ];
    }
  }
  const iamConfig = asRecord(body.iamConfiguration);
  // PATCH merges, so an explicit null clears the field: nulling the whole
  // block drops uniform access and public-access prevention at once.
  if (body.iamConfiguration === null) {
    errors.push(
      `${prefix}: clearing "iamConfiguration" removes uniform bucket-level access and public-access prevention — refused for safety`,
    );
  }
  if (iamConfig?.publicAccessPrevention === 'inherited') {
    errors.push(
      `${prefix}: downgrading publicAccessPrevention to "inherited" weakens the bucket — refused for safety`,
    );
  }
  const uniform = iamConfig?.uniformBucketLevelAccess;
  if (
    uniform === null ||
    (typeof uniform === 'object' &&
      uniform !== null &&
      !Array.isArray(uniform) &&
      (uniform as Record<string, unknown>).enabled === false)
  ) {
    errors.push(
      `${prefix}: disabling uniform bucket-level access weakens the bucket — refused for safety`,
    );
  }
  for (const key of ['acl', 'defaultObjectAcl']) {
    const list = body[key];
    if (Array.isArray(list) && list.some(isPublicAclEntry)) {
      errors.push(
        `${prefix}: granting "${key}" to the public (allUsers) exposes the bucket — refused for safety`,
      );
      continue;
    }
    // ACL writes are replace-shaped like bindings: a grant to a fresh
    // entity is an unreviewed privilege change, not a fix. Every entry
    // must already exist in the pre-fix state bound to this fix target —
    // an unbound record from another bucket proves nothing.
    if (Array.isArray(list) && list.length > 0) {
      const found = findPriorStateValue(realState, key, {
        ...(opts?.readSteps ? { readSteps: opts.readSteps } : {}),
        fixStep: step,
      });
      if (!found || !Array.isArray(found.value)) {
        errors.push(
          `${prefix}: granting "${key}" without pre-fix state cannot prove it removes nothing — refused for safety`,
        );
      } else {
        const priorList = found.value as unknown[];
        const subset = (list as unknown[]).every((entry) =>
          priorList.some((prior) => isDeepStrictEqual(prior, entry)),
        );
        if (!subset) {
          errors.push(
            `${prefix}: granting "${key}" to a new entity is an unreviewed privilege change — refused for safety`,
          );
        }
      }
    }
  }
  // Bucket IAM (`PUT .../storage/v1/b/<bucket>/iam`) carries `bindings`
  // with `members` — never `:setIamPolicy`, so the IAM guard never fires
  // here. A public member grant must refuse like a public ACL grant.
  // The IAM endpoint replaces the whole policy, so a body without
  // `bindings` deletes every binding — it cannot prove it removes nothing.
  // Scoped to the four-segment IAM path so a bucket literally named `iam`
  // (`/storage/v1/b/iam`) keeps the metadata rules below.
  const isBucketIamPath = /^\/storage\/v1\/b\/[^/]+\/iam$/.test(bucketPath);
  if (isBucketIamPath && body.bindings === undefined) {
    errors.push(
      `${prefix}: bucket IAM without "bindings" deletes every binding — refused for safety`,
    );
  } else if (bindingsGrantPublicAccess(body.bindings)) {
    errors.push(
      `${prefix}: granting "bindings" to the public (allUsers) exposes the bucket — refused for safety`,
    );
  } else if (body.bindings !== undefined) {
    const prior = findPriorPolicyForUrl(realState, opts?.readSteps, step);
    // etag pins the revision the fix was computed against — same bar as
    // `:setIamPolicy`. Without it a concurrent admin change is silently
    // clobbered by the whole-policy replace.
    if (
      isBucketIamPath &&
      typeof prior?.etag === 'string' &&
      prior.etag &&
      body.etag !== prior.etag
    ) {
      errors.push(
        `${prefix}: bucket IAM etag does not match the current policy — refused for safety`,
      );
    } else if (!bindingsSubsetOfPrior({ next: body.bindings, prior })) {
      errors.push(
        `${prefix}: granting "bindings" to a new principal is an unreviewed privilege change — refused for safety`,
      );
    }
  }
  // Canned ACLs grant without a body: `predefinedAcl` sets the bucket's
  // ACL, `predefinedDefaultObjectAcl` sets every future object's ACL —
  // the same public exposure under a sibling param name. Both execute
  // from the raw URL and from `queryParams`, so both sources scan.
  for (const param of ['predefinedAcl', 'predefinedDefaultObjectAcl']) {
    const publicAcl = stepQueryParamValues(step, param).find((value) =>
      isPublicPredefinedAcl(value),
    );
    if (publicAcl !== undefined) {
      errors.push(
        `${prefix}: canned ACL "${publicAcl}" grants public access — refused for safety`,
      );
    }
  }
  // Durability posture: disabling versioning or clearing the retention
  // policy is never an exposure fix — it deletes recovery guarantees.
  // PATCH merges, so only explicit disables refuse (absent ≠ removal).
  // Lifecycle rules run on the same axis: a Delete rule with age 0
  // destroys the bucket contents on a schedule, and no lifecycle edit
  // narrows an exposure — presence is a change, so presence refuses.
  if (body.lifecycle !== undefined) {
    errors.push(
      `${prefix}: editing the bucket lifecycle can delete or transition objects on a schedule — refused for safety`,
    );
  }
  const versioning = asRecord(body.versioning);
  // Explicit null clears the field under PATCH merge semantics — the same
  // removal as `enabled: false` under a narrower spelling.
  if (body.versioning === null || versioning?.enabled === false) {
    errors.push(
      `${prefix}: disabling bucket versioning removes recovery protection — refused for safety`,
    );
  }
  // Durability posture for the retention policy lives in
  // `gcp-remediation-bucket-retention-guardrails` (split for the 300-line
  // repo limit): clearing or shortening it is never an exposure fix.
  errors.push(
    ...validateGcpBucketRetentionPolicy({
      body,
      prefix,
      step,
      realState,
      ...(opts?.readSteps ? { readSteps: opts.readSteps } : {}),
    }),
  );
  return errors;
}
