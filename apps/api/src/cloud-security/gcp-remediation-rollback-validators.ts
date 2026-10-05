/**
 * Rollback-shape validators for AI-generated GCP rollback steps.
 *
 * Mirrors `remediation-rollback-validators.ts` for AWS: a rollback that
 * does not restore the exact prior state is worse than no rollback — it
 * leaves the resource in a third, unreviewed state. Every rejection routes
 * to an error, never to execution.
 *
 * Errors follow the `Step N (METHOD path): ...` convention so failures
 * attribute to the right step.
 */

import { isDeepStrictEqual } from 'node:util';
import {
  asRecord,
  isSetIamPolicyUrl,
  stepLabel,
  stepQueryParamValues,
  validateGcpStepProject,
} from './gcp-remediation-validator-shared';
import {
  findPriorPolicyForUrl,
  findPriorStateValue,
  getNestedValue,
  type GcpReadStepRef,
  type GcpStepIdentity,
} from './gcp-remediation-prior-state';
import type { GcpStepInput } from './gcp-remediation-step-url';
import { validateGcpRollbackOverlap } from './gcp-remediation-rollback-overlap';
import { validateMaskExternalBodyKeys } from './gcp-remediation-rollback-mask-coverage';
import { validatePostRollback } from './gcp-remediation-grant-checks';
import { validateGcpWriteStepParams } from './gcp-remediation-param-guardrails';

// Re-exported so existing importers keep working without churn.
export { validateGcpRollbackOverlap } from './gcp-remediation-rollback-overlap';
export type { GcpStepInput } from './gcp-remediation-step-url';

/**
 * IAM rollback must restore the verbatim prior policy: bindings,
 * auditConfigs, etag, and version must all match. A partial policy DELETES
 * everything not included — exactly the failure a rollback must never
 * produce. When the pre-fix state is available, the rollback must equal it
 * exactly — a well-formed but fabricated policy is still an unreviewed
 * write.
 */
function validateIamRollback(
  step: GcpStepInput,
  prefix: string,
  previousState?: Record<string, unknown>,
  opts?: {
    readSteps?: GcpReadStepRef[];
  },
): string[] {
  const errors: string[] = [];
  const body = step.body ?? {};
  const policy = asRecord(body.policy);
  if (
    !policy ||
    !Array.isArray(policy.bindings) ||
    policy.bindings.length === 0
  ) {
    errors.push(
      `${prefix}: IAM rollback must carry the full prior bindings array — refused for safety`,
    );
  }
  if (typeof policy?.etag !== 'string' || !policy.etag) {
    errors.push(
      `${prefix}: IAM rollback must carry the prior etag — refused for safety`,
    );
  }
  if (typeof policy?.version !== 'number') {
    errors.push(
      `${prefix}: IAM rollback must carry the prior policy version — refused for safety`,
    );
  }
  if (errors.length > 0) return errors;
  // Fail closed without a pre-fix policy to compare: a whole-policy
  // replace DELETES everything not included, so shape alone cannot prove
  // the rollback restores anything. This covers both absent state and
  // ambiguous state (several policies, no single match).
  const prior = findPriorPolicyForUrl(previousState, opts?.readSteps, step);
  if (!prior) {
    return [
      `${prefix}: IAM rollback has no pre-fix policy to compare — a well-formed but fabricated policy is still an unreviewed write — refused for safety`,
    ];
  }
  if (!isDeepStrictEqual(policy?.bindings, prior.bindings)) {
    errors.push(
      `${prefix}: IAM rollback bindings differ from the pre-fix policy — refused for safety`,
    );
  }
  if (
    typeof prior.etag === 'string' &&
    prior.etag &&
    policy?.etag !== prior.etag
  ) {
    errors.push(
      `${prefix}: IAM rollback etag differs from the pre-fix policy — refused for safety`,
    );
  }
  if (typeof prior.version === 'number' && policy?.version !== prior.version) {
    errors.push(
      `${prefix}: IAM rollback version differs from the pre-fix policy — refused for safety`,
    );
  }
  // `auditConfigs` is a first-class policy field honored by `setIamPolicy`:
  // a rollback with correct bindings/etag/version but dropped or rewritten
  // audit configs would silently delete the resource's audit-logging
  // config — the third, unreviewed state this validator exists to prevent.
  if (!isDeepStrictEqual(policy?.auditConfigs, prior.auditConfigs)) {
    errors.push(
      `${prefix}: IAM rollback auditConfigs differ from the pre-fix policy — refused for safety`,
    );
  }
  return errors;
}

/**
 * PUT/PATCH rollbacks must name the restored fields via `updateMask` — a
 * mask-less replace-shaped write risks side effects on fields the fix
 * never touched. POST rollbacks carry no field mask and face
 * `validatePostRollback` instead; DELETE carries no body and is
 * constrained by the overlap check (it must remove something the fix
 * created). When the pre-fix state is available, each
 * masked field must equal its prior value — otherwise the rollback writes
 * a third, unreviewed state. Dotted mask paths resolve into nested records
 * (`settings.ipConfiguration.ipv4Enabled`); each field searches every
 * read-state record on its own, since fields from different reads live in
 * different records. A field missing from all records fails closed when
 * reads ran — an unverifiable rollback is not a safe rollback.
 */
function validatePatchRollback(
  step: GcpStepInput,
  prefix: string,
  previousState?: Record<string, unknown>,
  opts?: {
    readSteps?: GcpReadStepRef[];
    fixStep?: GcpStepIdentity;
  },
): string[] {
  // `updateMask` executes from both the raw URL and `queryParams` (the
  // executor preserves `?...` in the URL and appends `queryParams`), so
  // the enforced field set is the union of both sources — a mask hiding
  // in either source restores, and every restored field must equal its
  // pre-fix value.
  const fields = [
    ...new Set(
      stepQueryParamValues(step, 'updateMask')
        .flatMap((mask) => mask.split(','))
        .map((field) => field.trim())
        .filter((field) => field.length > 0),
    ),
  ];
  if (fields.length === 0) {
    return [
      `${prefix}: ${step.method} rollback must carry queryParams.updateMask naming the restored fields — refused for safety`,
    ];
  }
  // Fail closed without pre-fix state: a masked write with nothing to
  // compare against is a well-formed but fabricated restore — the same
  // reason the IAM path refuses without a pre-fix policy. The
  // ambiguity-fail-closed lookup below already covers the case where reads
  // ran but match nothing; this covers reads never running at all.
  if (!previousState || Object.keys(previousState).length === 0) {
    return [
      `${prefix}: ${step.method} rollback has no pre-fix state to compare — a well-formed but fabricated rollback is still an unreviewed write — refused for safety`,
    ];
  }
  {
    const body = step.body ?? {};
    for (const field of fields) {
      // Bind each masked field to the fix target: without the URL binding
      // a lone record from another resource would validate this rollback.
      const found = findPriorStateValue(previousState, field, {
        ...(opts?.readSteps ? { readSteps: opts.readSteps } : {}),
        ...(opts?.fixStep ? { fixStep: opts.fixStep } : {}),
      });
      if (!found) {
        return [
          `${prefix}: ${step.method} rollback restores "${field}" with no pre-fix value to compare — refused for safety`,
        ];
      }
      if (!isDeepStrictEqual(getNestedValue(body, field), found.value)) {
        return [
          `${prefix}: ${step.method} rollback does not restore the pre-fix value of "${field}" — refused for safety`,
        ];
      }
    }
    // Mask-external body keys are verified in the coverage module: the
    // per-field loop above only compares masked paths, so anything the
    // mask never names must still prove its pre-fix value.
    return validateMaskExternalBodyKeys({
      body,
      fields,
      prefix,
      method: step.method,
      ...(previousState ? { previousState } : {}),
      ...(opts?.readSteps ? { readSteps: opts.readSteps } : {}),
      ...(opts?.fixStep ? { fixStep: opts.fixStep } : {}),
    });
  }
  return [];
}

/**
 * Validate rollback steps: IAM-verbatim + PUT/PATCH-mask + POST-replay
 * shapes, parameter guardrails (a rollback that widens posture is an
 * unreviewed write, not a restore), plus fix-overlap. `previousState` is
 * the pre-fix read state when available — rollback bodies are compared
 * against it so a well-formed but fabricated rollback cannot execute.
 * Called from the rollback flow alongside the allowlist check — empty
 * array means the rollback shape is sound.
 */
export function validateGcpRollbackSteps(
  rollbackSteps: GcpStepInput[],
  args: {
    fixSteps?: GcpStepInput[];
    previousState?: Record<string, unknown>;
    readSteps?: GcpReadStepRef[];
    /**
     * Project the finding under remediation belongs to. Rollbacks that
     * name a different project are refused — restoring another project's
     * resource is never a sound rollback.
     */
    expectedProjectId?: string;
    /**
     * Bucket the finding belongs to. Storage rollbacks must name this
     * bucket — restoring another bucket is never a sound rollback.
     */
    expectedBucket?: string;
  },
): string[] {
  const errors: string[] = [];
  rollbackSteps.forEach((step, i) => {
    const prefix = stepLabel(step, i);
    // Always runs: with no expected project or bucket it still refuses
    // project-scoped steps the finding cannot bind (fail closed).
    errors.push(
      ...validateGcpStepProject({
        step,
        expectedProjectId: args.expectedProjectId ?? '',
        ...(args.expectedBucket ? { expectedBucket: args.expectedBucket } : {}),
        prefix,
      }),
    );
    if (isSetIamPolicyUrl(step.url)) {
      errors.push(
        ...validateIamRollback(step, prefix, args.previousState, {
          ...(args.readSteps ? { readSteps: args.readSteps } : {}),
        }),
      );
    }
    if (step.method === 'PATCH' || step.method === 'PUT') {
      errors.push(
        ...validatePatchRollback(step, prefix, args.previousState, {
          ...(args.readSteps ? { readSteps: args.readSteps } : {}),
          fixStep: step,
        }),
      );
    }
    if (step.method === 'POST' && !isSetIamPolicyUrl(step.url)) {
      // IAM POSTs already face the stricter verbatim-vs-prior check above.
      errors.push(
        ...validatePostRollback({
          step,
          prefix,
          index: i,
          rollbackSteps,
          ...(args.fixSteps ? { fixSteps: args.fixSteps } : {}),
          ...(args.previousState ? { previousState: args.previousState } : {}),
        }),
      );
    }
    // IAM steps already face the stricter verbatim check above; every
    // other write faces the same dual-use parameter gates as fix steps —
    // with the same read-step binding, or URL-bound prior lookups degrade
    // to global matching and refuse valid rollbacks.
    if (step.method !== 'GET' && !isSetIamPolicyUrl(step.url)) {
      errors.push(
        ...validateGcpWriteStepParams(step, {
          ...(args.previousState ? { realState: args.previousState } : {}),
          ...(args.readSteps ? { readSteps: args.readSteps } : {}),
          index: i,
          isRollback: true,
        }),
      );
    }
  });
  if (args.fixSteps) {
    errors.push(...validateGcpRollbackOverlap(args.fixSteps, rollbackSteps));
  }
  return errors;
}
