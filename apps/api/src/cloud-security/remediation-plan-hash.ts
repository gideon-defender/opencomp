import { createHash } from 'node:crypto';
import {
  stableJsonStringify,
  type PlanHashBinding,
} from './remediation-stable-json';

export interface HashablePlanStep {
  method: string;
  url: string;
  body?: unknown;
  queryParams?: unknown;
  purpose?: string;
}

/**
 * Single SHA-256 acknowledgment-binding core shared by the GCP and Azure
 * remediators (they hash the same step shape and differ only in prefix).
 * AWS keeps its own helper: its steps hash a different shape
 * (`service`/`command`/`params` under `fix`/`rollback` keys), so sharing
 * would change stored AWS hashes.
 *
 * Only executed fields hash: free-text `purpose` rewording must never
 * read as a plan change. Rollback steps hash with fix steps: rollback
 * executes as writes under the same acknowledgment. The finding binding
 * hashes with the steps: without it, a hash previewed for one finding
 * authorizes a run for another with identical steps.
 */
export function hashRemediationPlanSteps(args: {
  provider: 'azure' | 'gcp';
  fixSteps: HashablePlanStep[];
  rollbackSteps?: HashablePlanStep[];
  binding: PlanHashBinding;
}): string {
  const shape = (entries: HashablePlanStep[]) =>
    entries.map((s) => ({
      method: s.method,
      url: s.url,
      body: s.body ?? null,
      // Query params change what the API mutates (`api-version` selects
      // behavior) — omitting them hashes distinct plans alike.
      queryParams: s.queryParams ?? null,
    }));
  const input = stableJsonStringify({
    binding: {
      organizationId: args.binding.organizationId,
      connectionId: args.binding.connectionId,
      checkResultId: args.binding.checkResultId,
      remediationKey: args.binding.remediationKey,
    },
    fixSteps: shape(args.fixSteps),
    rollbackSteps: shape(args.rollbackSteps ?? []),
  });
  return `${args.provider}-${createHash('sha256').update(input).digest('hex')}`;
}

/**
 * Refuse when the acknowledged preview hash no longer matches the steps
 * about to run. Callers check twice: once for the loaded plan, once
 * after refinement — refinement rewrites steps, so a single
 * pre-refinement check is a TOCTOU pass-through. Rollback steps compare
 * too: they run as writes under the same acknowledgment.
 */
export function assertRemediationPlanHash(args: {
  provider: 'azure' | 'gcp';
  expectedPlanHash: string | undefined;
  binding: PlanHashBinding;
  fixSteps: HashablePlanStep[];
  rollbackSteps?: HashablePlanStep[];
}): void {
  if (
    args.expectedPlanHash &&
    args.expectedPlanHash !==
      hashRemediationPlanSteps({
        provider: args.provider,
        fixSteps: args.fixSteps,
        rollbackSteps: args.rollbackSteps ?? [],
        binding: args.binding,
      })
  ) {
    throw new Error(
      'The previewed plan changed since you acknowledged it. Preview again and acknowledge the new plan before executing.',
    );
  }
}
