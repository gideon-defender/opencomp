/**
 * Prior policy/settings record lookups, plus the read-to-fix matcher behind
 * them.
 *
 * Split from `gcp-remediation-prior-state` to respect the 300-line repo
 * limit: state-map building stays there; record matching and extraction
 * live here. This module imports only from the `gcp-remediation-step-url`
 * leaf — never from `gcp-remediation-prior-state`, which imports from here.
 * That one-way edge is load-bearing: a cycle between these modules risks
 * `undefined` imports at module-eval time. All lookups fail closed on
 * ambiguity — see the function docs.
 */
import {
  asRecord,
  sameQueryIdentity,
  urlResource,
  type GcpStepQueryParams,
} from './gcp-remediation-step-url';

export interface GcpStepIdentity {
  url: string;
  queryParams?: GcpStepQueryParams;
}

export interface GcpReadStepRef extends GcpStepIdentity {
  purpose: string;
}

/**
 * Resource without its `:action` suffix (`.../b:setIamPolicy` → `.../b`).
 * IAM reads (`:getIamPolicy`) and writes (`:setIamPolicy`) target the same
 * resource under different actions — binding must compare resources, not
 * action URLs, or no read ever matches its fix.
 */
function resourceWithoutAction(resource: string): string {
  const action = resource.lastIndexOf(':');
  const slash = resource.lastIndexOf('/');
  if (action > slash) return resource.slice(0, action);
  return resource;
}

function readCoversFix(args: {
  readStep: GcpStepIdentity;
  fixStep: GcpStepIdentity;
}): boolean {
  const fix = resourceWithoutAction(urlResource(args.fixStep.url));
  const read = resourceWithoutAction(urlResource(args.readStep.url));
  if (!(fix === read || fix.startsWith(`${read}/`))) return false;
  // Query-selected identity (`?name=` picks the SQL user) constrains
  // binding the same way the path does — alice's read must never ground
  // bob's fix. Compare effective identity (raw URL plus merged
  // `queryParams`): the AI prompt sends params in either source, so raw
  // strings alone cannot tell them apart.
  return sameQueryIdentity(args.readStep, args.fixStep);
}

/**
 * Read steps whose URL covers `fixStep` (exact resource or parent, same
 * query identity) — the single matcher behind bound-record lookups, so
 * guards and lookups can never disagree on which reads ground a fix.
 */
export function coveringReadSteps(args: {
  readSteps?: GcpReadStepRef[];
  fixStep: GcpStepIdentity;
}): GcpReadStepRef[] {
  return (args.readSteps ?? []).filter((step) =>
    readCoversFix({ readStep: step, fixStep: args.fixStep }),
  );
}

function isPolicyRecord(record: Record<string, unknown>): boolean {
  return (
    Array.isArray(record.bindings) ||
    (record.policy !== null &&
      typeof record.policy === 'object' &&
      !Array.isArray(record.policy) &&
      Array.isArray((record.policy as Record<string, unknown>).bindings))
  );
}

function unwrapPolicy(outer: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(outer.bindings)) return outer;
  return outer.policy as Record<string, unknown>;
}

/**
 * Prior IAM policy in read state: a record carrying `bindings` directly,
 * or wrapping one under `policy` (`getIamPolicy` shape). Returns the policy
 * record itself so callers can compare fields against it.
 *
 * Fails closed on ambiguity: when two or more records carry policies (reads
 * covered several resources), a first-match pick could bind resource A's
 * policy to resource B's fix. Callers with the fix URL should prefer
 * `findPriorPolicyForUrl`.
 */
export function findPriorPolicy(
  realState: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!realState) return undefined;
  const matches = Object.values(realState)
    .map((value) => asRecord(value))
    .filter((record): record is Record<string, unknown> => record !== null)
    .filter(isPolicyRecord);
  if (matches.length !== 1) return undefined;
  return unwrapPolicy(matches[0]);
}

/**
 * Prior IAM policy bound to the fix target: only read outputs whose
 * read-step URL targets the fix resource (exact or parent) qualify. Fails
 * closed when no read-step map is available — falling back to an
 * unambiguous global match would bind resource A's policy to resource B's
 * fix whenever state holds a single policy.
 */
export function findPriorPolicyForUrl(
  realState: Record<string, unknown> | undefined,
  readSteps: GcpReadStepRef[] | undefined,
  fixStep: GcpStepIdentity,
): Record<string, unknown> | undefined {
  if (!realState) return undefined;
  if (!readSteps || readSteps.length === 0) return undefined;
  const purposes = new Set(
    coveringReadSteps({ readSteps, fixStep }).map((step) => step.purpose),
  );
  const matches = Object.entries(realState)
    .filter(([purpose]) => purposes.has(purpose))
    .map(([, value]) => asRecord(value))
    .filter((record): record is Record<string, unknown> => record !== null)
    .filter(isPolicyRecord);
  if (matches.length !== 1) return undefined;
  return unwrapPolicy(matches[0]);
}

function isSettingsRecord(record: Record<string, unknown>): boolean {
  return (
    (record.settings !== null &&
      typeof record.settings === 'object' &&
      !Array.isArray(record.settings)) ||
    record.ipConfiguration !== undefined ||
    record.databaseFlags !== undefined
  );
}

/**
 * Prior Cloud SQL record: `settings` wrapper or unwrapped output shape.
 * Fails closed on ambiguity like `findPriorPolicy` — see above.
 */
export function findPriorSettings(
  realState: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!realState) return undefined;
  const matches = Object.values(realState)
    .map((value) => asRecord(value))
    .filter((record): record is Record<string, unknown> => record !== null)
    .filter(isSettingsRecord);
  if (matches.length !== 1) return undefined;
  return matches[0];
}

/**
 * Prior Cloud SQL record bound to the fix target. Fails closed without a
 * read-step map — see `findPriorPolicyForUrl` for the binding rationale.
 */
export function findPriorSettingsForUrl(
  realState: Record<string, unknown> | undefined,
  readSteps: GcpReadStepRef[] | undefined,
  fixStep: GcpStepIdentity,
): Record<string, unknown> | undefined {
  if (!realState) return undefined;
  if (!readSteps || readSteps.length === 0) return undefined;
  const purposes = new Set(
    coveringReadSteps({ readSteps, fixStep }).map((step) => step.purpose),
  );
  const matches = Object.entries(realState)
    .filter(([purpose]) => purposes.has(purpose))
    .map(([, value]) => asRecord(value))
    .filter((record): record is Record<string, unknown> => record !== null)
    .filter(isSettingsRecord);
  if (matches.length !== 1) return undefined;
  return matches[0];
}

/**
 * Prior database flags at `settings.databaseFlags` (`instances.get` shape),
 * or top-level when the read output is unwrapped.
 */
export function extractPriorDatabaseFlags(
  prior: Record<string, unknown> | undefined,
): Array<{ name?: unknown }> | null {
  if (!prior) return null;
  const nested = prior.settings;
  if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
    const flags = (nested as Record<string, unknown>).databaseFlags;
    if (Array.isArray(flags)) return flags as Array<{ name?: unknown }>;
  }
  if (Array.isArray(prior.databaseFlags)) {
    return prior.databaseFlags as Array<{ name?: unknown }>;
  }
  return null;
}

/**
 * All prior database flags across every read-state record. Read state is
 * keyed by read-step purpose, so flags can live in a different record
 * from the settings object the connectivity check reads — collecting
 * from every record keeps the guard consistent with the per-field search
 * the rollback validators use. Returns null when no record carries flags.
 */
export function collectPriorDatabaseFlags(
  realState: Record<string, unknown> | undefined,
): Array<{ name?: unknown; value?: unknown }> | null {
  if (!realState) return null;
  const out: Array<{ name?: unknown; value?: unknown }> = [];
  for (const value of Object.values(realState)) {
    const record = asRecord(value);
    if (!record) continue;
    const flags = extractPriorDatabaseFlags(record);
    if (flags) out.push(...flags);
  }
  return out.length > 0 ? out : null;
}
