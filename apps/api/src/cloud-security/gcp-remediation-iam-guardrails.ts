import { isDeepStrictEqual } from 'node:util';
import { asRecord } from './gcp-remediation-validator-shared';
import {
  findPriorPolicy,
  findPriorPolicyForUrl,
  type GcpReadStepRef,
  type GcpStepIdentity,
} from './gcp-remediation-prior-state';

/**
 * `setIamPolicy` REPLACES the whole policy: refuse bodies that change
 * `auditConfigs` present in the read-step state, and refuse binding
 * changes that are not strict removals. A same-length swap or an additive
 * grant passes a length check but still escalates privilege, so every new
 * binding must already exist in the prior policy — removals (e.g. dropping
 * a public grant) are the only allowed delta. Without read state, refuse
 * outright: a partial policy DELETES everything not included, so even a
 * full-looking shape cannot prove it restores nothing.
 */
export function validateGcpSetIamPolicy(
  body: Record<string, unknown>,
  realState: Record<string, unknown> | undefined,
  prefix: string,
  opts?: {
    readSteps?: GcpReadStepRef[];
    fixStep?: GcpStepIdentity;
  },
): string[] {
  const errors: string[] = [];
  const policy = asRecord(body.policy);
  if (!policy) {
    return [
      `${prefix}: setIamPolicy body must carry the full "policy" object — refused for safety`,
    ];
  }
  const prior =
    opts?.fixStep !== undefined
      ? findPriorPolicyForUrl(realState, opts.readSteps, opts.fixStep)
      : findPriorPolicy(realState);
  if (prior) {
    if (
      prior.auditConfigs !== undefined &&
      !isDeepStrictEqual(policy.auditConfigs, prior.auditConfigs)
    ) {
      errors.push(
        `${prefix}: setIamPolicy changes "auditConfigs" present in the current policy — refused for safety`,
      );
    }
    // Enabling audit logging is a fix — but only when it adds coverage.
    // A newly introduced `auditConfigs` carrying `exemptedMembers` hides
    // actors from the audit trail, which weakens auditability the same
    // way editing present configs does.
    if (prior.auditConfigs === undefined && policy.auditConfigs !== undefined) {
      const added = Array.isArray(policy.auditConfigs)
        ? policy.auditConfigs
        : [];
      const hidesActors = added.some((config) => {
        const record = asRecord(config);
        const logConfigs = record?.auditLogConfigs;
        if (!Array.isArray(logConfigs)) return false;
        return logConfigs.some((logConfig) => {
          const exempted = asRecord(logConfig)?.exemptedMembers;
          return Array.isArray(exempted) && exempted.length > 0;
        });
      });
      if (hidesActors) {
        errors.push(
          `${prefix}: setIamPolicy introduces "auditConfigs" with exemptedMembers that hide actors from audit logging — refused for safety`,
        );
      }
    }
    // etag/version pin the policy revision the fix was computed against —
    // a fabricated value means the fix was not built from the read state.
    if (
      typeof prior.etag === 'string' &&
      prior.etag &&
      policy.etag !== prior.etag
    ) {
      errors.push(
        `${prefix}: setIamPolicy etag does not match the current policy — refused for safety`,
      );
    }
    if (typeof prior.version === 'number' && policy.version !== prior.version) {
      errors.push(
        `${prefix}: setIamPolicy version does not match the current policy — refused for safety`,
      );
    }
    const priorBindings = Array.isArray(prior.bindings) ? prior.bindings : [];
    const nextBindings = Array.isArray(policy.bindings) ? policy.bindings : [];
    if (priorBindings.length > 0 && nextBindings.length === 0) {
      errors.push(
        `${prefix}: setIamPolicy drops "bindings" present in the current policy — refused for safety`,
      );
    } else {
      for (const binding of nextBindings) {
        if (
          !priorBindings.some((priorBinding) =>
            isDeepStrictEqual(priorBinding, binding),
          )
        ) {
          errors.push(
            `${prefix}: setIamPolicy adds or changes a binding not present in the current policy — refused for safety`,
          );
          break;
        }
      }
    }
  } else {
    errors.push(
      `${prefix}: setIamPolicy without read state cannot prove it changes nothing — refused for safety`,
    );
  }
  return errors;
}
