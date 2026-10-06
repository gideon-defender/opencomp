import { isDeepStrictEqual } from 'node:util';
import { asRecord } from './gcp-remediation-validator-shared';
import { coveringReadSteps } from './gcp-remediation-prior-lookups';
import {
  extractPriorDatabaseFlags,
  type GcpReadStepRef,
  type GcpStepIdentity,
} from './gcp-remediation-prior-state';

/**
 * Cloud SQL database-flags guardrails for AI-generated GCP fix steps.
 *
 * Split from `gcp-remediation-sql-guardrails` to respect the 300-line
 * repo limit. Every rejection routes the plan to guided-only, never to
 * execution.
 */

/**
 * Instance PATCH is replace-shaped for flags: refuse arrays that drop
 * flags present in the read state, change a flag value, or add a flag
 * the pre-fix state cannot vouch for. Flags bind to the fix target like
 * every other SQL check: a flag that is new to this instance but present
 * in another instance's read record must not pass as pre-existing. Split
 * records still resolve — only the records whose read covers the fix
 * target qualify, and exactly one may carry flags. Zero or several is
 * unprovable either way: fail closed. A repeated flag name with different
 * values refuses as ambiguous — the map collapse would otherwise check
 * one value while the executed array carries another.
 */
export function validateGcpSqlDatabaseFlags(args: {
  databaseFlags: unknown;
  prefix: string;
  realState: Record<string, unknown> | undefined;
  readSteps?: GcpReadStepRef[];
  fixStep?: GcpStepIdentity;
}): string[] {
  const errors: string[] = [];
  const priorFlags = boundDatabaseFlags();
  function boundDatabaseFlags(): Array<{
    name?: unknown;
    value?: unknown;
  }> | null {
    if (args.fixStep === undefined) return null;
    const purposes = new Set(
      coveringReadSteps({
        ...(args.readSteps ? { readSteps: args.readSteps } : {}),
        fixStep: args.fixStep,
      }).map((step) => step.purpose),
    );
    if (purposes.size === 0 || !args.realState) return null;
    const candidates: Array<{ name?: unknown; value?: unknown }>[] = [];
    for (const [purpose, value] of Object.entries(args.realState)) {
      if (!purposes.has(purpose)) continue;
      const record = asRecord(value);
      if (!record) continue;
      const flags = extractPriorDatabaseFlags(record);
      if (flags) {
        candidates.push(flags);
      }
    }
    if (candidates.length !== 1) return null;
    return candidates[0] ?? null;
  }
  if (!priorFlags) {
    errors.push(
      `${args.prefix}: databaseFlags edits without bound read state delete unknown flags — refused for safety`,
    );
    return errors;
  }
  const nextByName = new Map<string, unknown>();
  for (const flag of args.databaseFlags as Array<{
    name?: unknown;
    value?: unknown;
  }>) {
    if (typeof flag?.name === 'string' && flag.name) {
      // Duplicate names are ambiguous: the checks below only see the
      // collapsed map, so a second entry with a different value would
      // pass against the wrong value while the executed array still
      // carries the unreviewed one. Identical repeats are
      // effect-equivalent under any duplicate semantics and stay allowed.
      if (
        nextByName.has(flag.name) &&
        !isDeepStrictEqual(nextByName.get(flag.name), flag.value)
      ) {
        errors.push(
          `${args.prefix}: databaseFlags repeats flag "${flag.name}" with different values — the executed value is ambiguous, refused for safety`,
        );
      }
      nextByName.set(flag.name, flag.value);
    }
  }
  const priorNames = new Set<string>();
  for (const flag of priorFlags) {
    if (typeof flag?.name !== 'string' || !flag.name) continue;
    priorNames.add(flag.name);
    if (!nextByName.has(flag.name)) {
      errors.push(
        `${args.prefix}: databaseFlags drops pre-existing flag "${flag.name}" — refused for safety`,
      );
    } else if (
      !isDeepStrictEqual(
        nextByName.get(flag.name),
        (flag as { value?: unknown }).value,
      )
    ) {
      errors.push(
        `${args.prefix}: databaseFlags changes the value of pre-existing flag "${flag.name}" — refused for safety`,
      );
    }
  }
  // Instance PATCH is replace-shaped: a flag absent from the pre-fix
  // state is a new flag the read state cannot vouch for — an
  // unverifiable change, not a narrowing. Fail closed like the drop
  // and value-change refusals above.
  for (const name of nextByName.keys()) {
    if (!priorNames.has(name)) {
      errors.push(
        `${args.prefix}: databaseFlags adds new flag "${name}" beyond the pre-fix flags — refused for safety`,
      );
    }
  }
  return errors;
}
