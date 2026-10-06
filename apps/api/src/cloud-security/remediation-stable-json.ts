/**
 * Provider-neutral stable JSON encoding for plan hashes.
 *
 * Split out of `gcp-remediation-plan.utils` so the AWS service does not
 * import a `gcp-` module for a generic helper. Pure functions only.
 */

/**
 * Finding scope a plan hash binds to. The acknowledgment hash covers step
 * bytes plus these identifiers, so a hash previewed for one finding cannot
 * authorize a run for another — even when the steps collide (same project,
 * same generic fix shape).
 */
export interface PlanHashBinding {
  organizationId: string;
  connectionId: string;
  checkResultId: string;
  remediationKey: string;
}

/**
 * Stable JSON encoding for plan hashes: plain-object keys sort
 * recursively so AI-regenerated plans with reordered keys hash alike.
 * Arrays keep order (step order is semantically meaningful). Matches
 * `JSON.stringify` semantics for `undefined` (dropped from objects,
 * `null` in arrays) so digests stay comparable with older hashes over
 * already-sorted input.
 */
export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    // Null-prototype accumulator: assigning a `__proto__` own key (which
    // AI-generated bodies can carry after JSON.parse) onto `{}` would set
    // the prototype instead of an own field, and JSON.stringify would drop
    // it — two different plans would hash alike and pass the acknowledgment
    // binding. JSON.stringify reads own enumerable fields, so a
    // null-prototype object encodes identically for normal keys.
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) out[key] = canonicalize(entry);
    }
    return out;
  }
  return value;
}
