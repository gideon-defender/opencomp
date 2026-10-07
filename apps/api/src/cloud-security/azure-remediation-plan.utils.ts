import type { PlanHashBinding } from './remediation-stable-json';
import { stableJsonStringify } from './remediation-stable-json';
import {
  assertRemediationPlanHash,
  hashRemediationPlanSteps,
  type HashablePlanStep,
} from './remediation-plan-hash';
import { normalizeAzureUrlForAllowlist } from '@gideon-defender/integration-platform';
import {
  buildEffectiveAzureStepUrl,
  extractAzureResourceGroup,
  extractAzureStepSubscriptionId,
  sortedQueryEntries,
} from './azure-remediation-step-url';

/** Same step shape the shared hash core hashes — alias, not a copy. */
type AzureHashableStep = HashablePlanStep;

/**
 * Stable hash of an Azure plan for the acknowledgment binding. Thin
 * wrapper over the shared core — the hash bytes are unchanged. See the
 * core for the binding contract (executed fields, rollback, finding).
 */
export function hashAzurePlanSteps(
  steps: AzureHashableStep[],
  rollbackSteps: AzureHashableStep[] = [],
  binding: PlanHashBinding,
): string {
  return hashRemediationPlanSteps({
    provider: 'azure',
    fixSteps: steps,
    rollbackSteps,
    binding,
  });
}

/**
 * Refuse when the acknowledged preview hash no longer matches the steps
 * about to run. Thin wrapper over the shared core — see it for the
 * double-check contract.
 */
export function assertAcknowledgedPlanHash(args: {
  expectedPlanHash: string | undefined;
  binding: PlanHashBinding;
  fixSteps: AzureHashableStep[];
  rollbackSteps?: AzureHashableStep[];
}): void {
  assertRemediationPlanHash({
    provider: 'azure',
    expectedPlanHash: args.expectedPlanHash,
    binding: args.binding,
    fixSteps: args.fixSteps,
    ...(args.rollbackSteps ? { rollbackSteps: args.rollbackSteps } : {}),
  });
}

/**
 * Pin a self-heal retry to the acknowledged targets: the retry may carry
 * new bodies (error context changes values), but methods plus targets
 * must match the plan under execution exactly — a retry that drifts to
 * new resources is a new plan, and new plans need a new preview.
 *
 * Targets compare on the normalized URL PLUS the subscription and
 * resource group the allowlist normalization strips, PLUS the query
 * params it drops: without the scope suffix, a retry drifting across
 * subscriptions or resource groups compares equal and the pin proves
 * nothing — and without query params, an `api-version` swap (which
 * selects API behavior) compares equal too.
 */
export function assertAzureRetryTargetsPinned(args: {
  currentFixSteps: AzureHashableStep[];
  retryFixSteps: AzureHashableStep[];
}): void {
  const target = (step: AzureHashableStep): string => {
    const effective = buildEffectiveAzureStepUrl({
      url: step.url,
      queryParams: step.queryParams as Record<string, string> | undefined,
    });
    const normalized =
      normalizeAzureUrlForAllowlist(effective) ?? effective.toLowerCase();
    const subscription =
      extractAzureStepSubscriptionId(effective)?.toLowerCase() ?? '';
    const resourceGroup =
      extractAzureResourceGroup(effective)?.toLowerCase() ?? '';
    // Compare the query the wire carries, not just the `queryParams`
    // object: the executor merges both into the URL, so a retry that
    // swaps an api-version embedded in `url` must read as drift even
    // when the object is untouched (or absent on both sides).
    const query = stableJsonStringify(sortedQueryEntries(effective));
    return `${step.method} ${normalized} ${subscription} ${resourceGroup} ${query}`;
  };
  const current = args.currentFixSteps.map(target);
  const retry = args.retryFixSteps.map(target);
  const pinned =
    current.length === retry.length &&
    current.every((entry, i) => entry === retry[i]);
  if (!pinned) {
    throw new Error(
      'The regenerated retry plan targets different resources than the acknowledged plan. Preview again and acknowledge the new plan before executing.',
    );
  }
}

/** Every leaf path of a JSON value, e.g. `properties.allowBlobPublicAccess`.
 * Array indices are path segments (`properties.logs.0.enabled`), so a new
 * element reads as a new path. Empty containers contribute their own path
 * so populating an acknowledged-empty object or array still shows up.
 * Shared with `azure-remediation-verify-paths` for write attribution. */
export function collectLeafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') {
    return prefix ? [prefix] : [];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return prefix ? [prefix] : [];
    return value.flatMap((entry, i) =>
      collectLeafPaths(entry, prefix ? `${prefix}.${i}` : `${i}`),
    );
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return prefix ? [prefix] : [];
  return keys.flatMap((key) =>
    collectLeafPaths(
      (value as Record<string, unknown>)[key],
      prefix ? `${prefix}.${key}` : key,
    ),
  );
}

/** True when two leaf paths overlap: equal, or one nests under the other.
 * Overlap in either direction counts as "touched" — a retry that collapses
 * a previewed object to a scalar narrows the write, while one that expands
 * a previewed scalar into an object smuggles new fields. */
function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

/**
 * Leaf paths the fix steps write — see `azure-remediation-verify-paths`
 * (`azureFixWrittenPaths`, `azureFixWrittenPathsByPurpose`), which own
 * write attribution so this file stays under the 300-line repo limit.
 */

/** Flatten one state entry to relative leaf path → canonical value. */
function flattenEntry(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const path of collectLeafPaths(value)) {
    out.set(path, stableJsonStringify(valueAtPath(value, path)));
  }
  return out;
}

/** Value at a dot-path built by `collectLeafPaths` (indices for arrays). */
function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = Array.isArray(current)
      ? current[Number(segment)]
      : (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Relative leaf paths whose canonical value differs between two entries. */
function changedPaths(previous: unknown, post: unknown): string[] {
  const prevIsObj = previous !== null && typeof previous === 'object';
  const postIsObj = post !== null && typeof post === 'object';
  if (!prevIsObj || !postIsObj) {
    return stableJsonStringify(previous) === stableJsonStringify(post)
      ? []
      : ['.'];
  }
  const before = flattenEntry(previous);
  const after = flattenEntry(post);
  const changed: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) !== after.get(key)) changed.push(key);
  }
  return changed;
}

/**
 * Decide whether the post-fix re-read proves the fix took effect.
 * Canonical JSON comparison: key order in ARM responses is not stable,
 * so a raw stringify flips the verdict on identical states. No verify
 * data is not proof of a fix — an empty post-state (every verify read
 * failed) reads as unverified — and with no captured before state there
 * is nothing to compare against.
 *
 * With `writtenPaths` (leaf paths the fix steps wrote), only changes
 * that overlap a written path verify: unrelated drift (`etag` churn,
 * another actor's edit) with the vulnerable setting untouched reads as
 * unverified, never as proof. Without `writtenPaths` any change
 * verifies (legacy behavior).
 *
 * With `writtenPathsByPurpose` (see `azureFixWrittenPathsByPurpose` in
 * `azure-remediation-verify-paths`), each purpose entry verifies against
 * its own writes only: drift in one entry never proves a fix written to
 * another, even when both use the same relative path. Only purposes
 * present in both states compare — refinement can rename purposes
 * between reads, and differing key sets always differ as JSON. Scalar
 * (non-object) entries stay fail-safe: a whole-entry change with no
 * attributable path reads as unverified.
 */
export function isFixVerifiedByState(args: {
  previousState: Record<string, unknown>;
  postFixState: Record<string, unknown>;
  writtenPaths?: string[];
  writtenPathsByPurpose?: Record<string, string[]>;
}): boolean {
  if (
    Object.keys(args.previousState).length === 0 ||
    Object.keys(args.postFixState).length === 0
  ) {
    return false;
  }
  if (args.writtenPathsByPurpose) {
    return Object.keys(args.previousState).some((key) => {
      if (!Object.prototype.hasOwnProperty.call(args.postFixState, key)) {
        return false;
      }
      const changed = changedPaths(
        args.previousState[key],
        args.postFixState[key],
      );
      if (changed.length === 0) return false;
      // A whole-entry change ('.') names no attributable path.
      if (changed.some((path) => path === '.')) return false;
      const written = args.writtenPathsByPurpose?.[key] ?? [];
      return changed.some((path) =>
        written.some((writtenPath) => pathsOverlap(path, writtenPath)),
      );
    });
  }
  const changed: string[] = [];
  const keys = new Set([
    ...Object.keys(args.previousState),
    ...Object.keys(args.postFixState),
  ]);
  for (const key of keys) {
    changed.push(
      ...changedPaths(args.previousState[key], args.postFixState[key]),
    );
  }
  if (changed.length === 0) return false;
  const written = args.writtenPaths ?? [];
  if (written.length === 0) return true;
  return changed.some((path) =>
    written.some((writtenPath) => pathsOverlap(path, writtenPath)),
  );
}

/**
 * Pin a self-heal retry to the acknowledged value shape: the retry may
 * correct values inside fields the acknowledged plan already wrote, but
 * it must not introduce new fields at ANY depth. A new nested field is
 * new behavior the user never previewed — and error-text-planted fields
 * are exactly how a regenerated plan smuggles unreviewed writes past the
 * target pin, which only compares methods and URLs. Pairwise by index:
 * call after `assertAzureRetryTargetsPinned`, which already proved the
 * two lists align exactly.
 */
export function assertAzureRetryBodiesPinned(args: {
  currentFixSteps: AzureHashableStep[];
  retryFixSteps: AzureHashableStep[];
}): void {
  for (let i = 0; i < args.retryFixSteps.length; i++) {
    const current = args.currentFixSteps[i];
    const retry = args.retryFixSteps[i];
    if (!current || !retry) {
      throw new Error(
        'The regenerated retry plan targets different resources than the acknowledged plan. Preview again and acknowledge the new plan before executing.',
      );
    }
    const allowed = collectLeafPaths(current.body);
    // One-directional coverage: a retry leaf is covered only by the same
    // acknowledged path or by an acknowledged path beneath it (collapsing
    // a previewed object to a scalar narrows the write). The reverse — a
    // retry leaf beneath an acknowledged scalar — is expansion: a new
    // field at a depth the preview never wrote, and it is refused.
    const introduced = collectLeafPaths(retry.body).filter(
      (path) =>
        !allowed.some(
          (kept) => path === kept || kept.startsWith(`${path}.`),
        ),
    );
    if (introduced.length > 0) {
      throw new Error(
        `The regenerated retry plan writes new fields (${introduced.join(', ')}) the acknowledged plan never wrote. Preview again and acknowledge the new plan before executing.`,
      );
    }
  }
}
