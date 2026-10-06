/**
 * Prior read-state lookups bound to the fix target.
 *
 * Split from `gcp-remediation-validator-shared` to respect the 300-line
 * repo limit; policy/settings extraction lives in
 * `gcp-remediation-prior-lookups` (re-exported below so existing importers
 * keep working). This module imports from the lookups module — never the
 * reverse, or the two form an import cycle. Read state is keyed by
 * read-step purpose, so a first-match pick can bind resource A's policy to
 * resource B's fix — every lookup below fails closed on ambiguity and
 * prefers the URL-bound variant.
 *
 * URL canonicalization (`urlResource`) and record narrowing (`asRecord`)
 * come from the `gcp-remediation-step-url` leaf — local copies drifted
 * (single-decode vs fixed-point), so this module must not define its own.
 */
import { asRecord, buildEffectiveGcpStepUrl } from './gcp-remediation-step-url';
import { coveringReadSteps } from './gcp-remediation-prior-lookups';
import type {
  GcpReadStepRef,
  GcpStepIdentity,
} from './gcp-remediation-prior-lookups';

export {
  collectPriorDatabaseFlags,
  coveringReadSteps,
  extractPriorDatabaseFlags,
  findPriorPolicy,
  findPriorPolicyForUrl,
  findPriorSettings,
  findPriorSettingsForUrl,
} from './gcp-remediation-prior-lookups';
export type {
  GcpReadStepRef,
  GcpStepIdentity,
} from './gcp-remediation-prior-lookups';

/**
 * Build the purpose-keyed read-state map from executor results. Refuses
 * duplicate or missing purposes: two reads sharing a purpose would silently
 * overwrite each other and ground refinement on incomplete data, so the run
 * fails instead of fixing blind.
 */
export function buildPriorStateMap(
  results: Array<{ step: { purpose: string }; output: unknown }>,
): Record<string, unknown> {
  // Null-prototype map: `purpose` is AI-controlled, and assigning a
  // `__proto__` purpose onto `{}` would set the prototype instead of an
  // own entry — the read output would vanish from later lookups and the
  // duplicate check below would never fire on a second `__proto__`.
  const state: Record<string, unknown> = Object.create(null);
  for (const result of results) {
    const purpose = result.step.purpose;
    if (typeof purpose !== 'string' || purpose.length === 0) {
      throw new Error(
        'Read steps must carry a purpose so state binds to the right resource.',
      );
    }
    if (Object.prototype.hasOwnProperty.call(state, purpose)) {
      throw new Error(
        `Duplicate read-step purpose "${purpose}" — purposes must be unique so state binds to the right resource.`,
      );
    }
    state[purpose] = result.output;
  }
  return state;
}

/** Resolve a dotted field path (`a.b.c`) against nested records. */
export function getNestedValue(
  record: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = record;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * The single read-state record where dotted `path` resolves to a defined
 * value, with the value itself. Each masked field searches on its own —
 * read state is keyed by read-step purpose, so fields from different reads
 * live in different records and never share one. Fails closed on
 * ambiguity: when two records resolve the same path, either could be the
 * wrong resource's value, so no value is returned.
 *
 * When `readSteps` + `fixStep` are provided, only records produced by reads
 * covering the fix target qualify — a lone record from project A must
 * never validate a rollback for project B just because it is the only
 * record in state.
 */
export function findPriorStateValue(
  realState: Record<string, unknown> | undefined,
  path: string,
  opts?: {
    readSteps?: GcpReadStepRef[];
    fixStep?: GcpStepIdentity;
  },
): { record: Record<string, unknown>; value: unknown } | undefined {
  if (!realState) return undefined;
  const fixStep = opts?.fixStep;
  let purposes: Set<string> | undefined;
  if (fixStep !== undefined) {
    if (!opts?.readSteps || opts.readSteps.length === 0) return undefined;
    purposes = new Set(
      coveringReadSteps({ readSteps: opts.readSteps, fixStep }).map(
        (step) => step.purpose,
      ),
    );
  }
  const matches: Array<{
    record: Record<string, unknown>;
    value: unknown;
  }> = [];
  for (const [purpose, value] of Object.entries(realState)) {
    if (purposes && !purposes.has(purpose)) continue;
    const record = asRecord(value);
    if (!record) continue;
    const nested = getNestedValue(record, path);
    if (nested !== undefined) matches.push({ record, value: nested });
  }
  if (matches.length !== 1) return undefined;
  return matches[0];
}

/**
 * The single read-state record produced by reads covering `fixStep`, or
 * `undefined` when zero or several records qualify. Unlike
 * `findPriorStateValue` (which proves a field's value), this proves a
 * record's presence — callers use it to tell "the bound resource was read
 * and carries no such field" (genuinely absent, e.g. a bucket that never
 * had a retention policy) apart from "no bound read exists" (unprovable).
 * Ambiguity fails closed the same way: several covering records prove
 * nothing about which one the fix targets.
 */
export function findBoundPriorRecord(
  realState: Record<string, unknown> | undefined,
  opts: {
    readSteps?: GcpReadStepRef[];
    fixStep: GcpStepIdentity;
  },
): Record<string, unknown> | undefined {
  if (!realState) return undefined;
  const purposes = new Set(
    coveringReadSteps({ readSteps: opts.readSteps, fixStep: opts.fixStep }).map(
      (step) => step.purpose,
    ),
  );
  if (purposes.size === 0) return undefined;
  const matches = Object.entries(realState)
    .filter(([purpose]) => purposes.has(purpose))
    .map(([, value]) => asRecord(value))
    .filter((record): record is Record<string, unknown> => record !== null);
  if (matches.length !== 1) return undefined;
  return matches[0];
}

/**
 * True when the read at `step` selects a field subset (`?fields=`).
 * A field-masked read can omit the very field a guard compares against,
 * so "bound record carries no such field" proves nothing when the
 * covering read was masked — callers must treat the value as unprovable.
 * Reads the effective URL (raw URL plus merged `queryParams`) so a mask
 * hiding in either source counts.
 */
export function isFieldMaskedReadUrl(step: GcpStepIdentity): boolean {
  try {
    return new URL(buildEffectiveGcpStepUrl(step)).searchParams.has('fields');
  } catch {
    return true;
  }
}
