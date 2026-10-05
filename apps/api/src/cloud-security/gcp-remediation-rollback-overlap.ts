/**
 * Rollback-to-fix overlap for GCP remediation plans.
 *
 * Split from `gcp-remediation-step-url` to respect the 300-line repo
 * limit. Pure overlap check — parameter gates live with the validators.
 */
import {
  sameQueryIdentity,
  stepLabel,
  urlResource,
  type GcpStepInput,
} from './gcp-remediation-step-url';

/**
 * Every rollback step must target a resource the fix wrote: the exact fix
 * resource or below it. Only fix writes (POST/PUT/PATCH) anchor overlap —
 * a read (GET) or delete (DELETE) fix step never proves the rollback
 * restores a fixed resource. DELETE is stricter — it must remove something
 * the fix created (POST/PUT). An exact-resource DELETE qualifies on its
 * own; a DELETE below the fix collection must name the child the fix body
 * created, since a bare "below it" match also covers pre-existing siblings
 * the fix never wrote. A rollback anywhere else is either stale or
 * attacker-shaped.
 * `fixSteps` is the executed fix-step list.
 *
 * Identity that lives in the query string (`?name=` selects SQL users)
 * constrains overlap too: a rollback for `?name=bob` does not restore a
 * fix for `?name=alice`, even on the same path.
 *
 * When the two lists are the same length, each rollback step must overlap
 * its same-index fix step: the executor compensates by position
 * (`rollback[j]` undoes fix step `j`), so an order-free overlap would let
 * a reordered rollback pass validation and then undo the wrong step on
 * partial failure. Unequal lengths keep the any-overlap rule — the
 * executor refuses non-1:1 auto-rollback, and manual rollback executes
 * the steps directly without positional compensation.
 */
/**
 * Body keys whose values merely mention names without creating them. A
 * created child's name belongs in an identity field (`name`,
 * `datasetReference`, ...); a mention in free text must never authorize a
 * DELETE of a resource carrying that name.
 */
const FIX_BODY_FREETEXT_KEYS: readonly string[] = [
  'description',
  'displayName',
  'title',
  'friendlyName',
];

/**
 * True for body keys that can carry the created child's identity: `name`,
 * `id`, and camelCase `*Id` / `*Name` references (`datasetId`, `tableId`).
 * Free-text keys never count even when they end in `Name` (`friendlyName`
 * mentions names without creating them). Any other key's value — labels,
 * metadata, annotations — can coincidentally equal a sibling's name, so
 * only identity values may authorize a DELETE.
 */
function isIdentityKey(key: string): boolean {
  if (FIX_BODY_FREETEXT_KEYS.includes(key)) return false;
  return (
    key.toLowerCase() === 'name' ||
    key.toLowerCase() === 'id' ||
    key.endsWith('Id') ||
    key.endsWith('Name')
  );
}

/**
 * Identity string values in a fix body. Object keys never name the
 * created child (they are field names), free-text values only mention
 * names, and label/metadata values can coincide with a sibling's name —
 * all are excluded so a bare mention cannot authorize a DELETE.
 */
function bodyIdentityValues(body: Record<string, unknown>): Set<string> {
  const values = new Set<string>();
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === 'string') {
      // The key must be known: a bare string (e.g. an array element
      // under an unkeyed parent) never counts.
      if (key !== undefined && isIdentityKey(key)) {
        values.add(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [entryKey, entry] of Object.entries(value)) {
        visit(entry, entryKey);
      }
    }
  };
  visit(body);
  return values;
}

/**
 * True when the rollback resource names the child the fix step created.
 * A POST to a collection creates one child — without tying the DELETE
 * target to the fix body, any pre-existing sibling passes overlap and the
 * rollback deletes data the fix never wrote. The match runs on identity
 * values in the body (`name`, `*Id` references), so only a real identity
 * value counts — not a substring of a longer value, an object key, a
 * free-text mention, or a coincidental label/metadata value.
 */
function childNamedInFixBody(args: {
  fixBody?: Record<string, unknown>;
  resource: string;
}): boolean {
  const child = args.resource.split('/').pop() ?? '';
  if (child.length === 0 || args.fixBody === undefined) return false;
  return bodyIdentityValues(args.fixBody).has(child);
}

export function validateGcpRollbackOverlap(
  fixSteps: GcpStepInput[],
  rollbackSteps: GcpStepInput[],
): string[] {
  const errors: string[] = [];
  const fixResources = fixSteps.map((s) => ({
    resource: urlResource(s.url),
    method: s.method,
    step: s,
  }));
  const positional =
    fixSteps.length > 0 && fixSteps.length === rollbackSteps.length;
  rollbackSteps.forEach((step, i) => {
    // A read restores nothing: without this, a GET rollback passes
    // overlap against any fix write below and counts as rollback coverage
    // for a step that changes nothing on failure.
    if (step.method === 'GET') {
      errors.push(
        `${stepLabel(step, i)}: rollback step is a read — a read restores nothing — refused for safety`,
      );
      return;
    }
    const resource = urlResource(step.url);
    const overlapsAt = (fixIndex: number): boolean => {
      const fix = fixResources[fixIndex];
      const sameOrChild =
        resource === fix.resource || resource.startsWith(`${fix.resource}/`);
      if (!sameOrChild) return false;
      if (!sameQueryIdentity(step, fix.step)) return false;
      if (step.method === 'DELETE') {
        if (fix.method !== 'POST' && fix.method !== 'PUT') return false;
        // Exact-resource DELETE destroys the resource itself: only a POST
        // fix provably created it. A PUT fix may have updated a
        // pre-existing resource, so an exact DELETE is destruction rather
        // than compensation — refuse instead of deleting what the fix
        // never created.
        if (resource === fix.resource) return fix.method === 'POST';
        return childNamedInFixBody({
          fixBody: fix.step.body,
          resource,
        });
      }
      // A write rollback must anchor on a fix write: a GET fix step only
      // read the resource, so overlapping it proves nothing about a restore.
      return (
        fix.method === 'POST' || fix.method === 'PUT' || fix.method === 'PATCH'
      );
    };
    const overlaps = positional
      ? overlapsAt(i)
      : fixResources.some((_, fixIndex) => overlapsAt(fixIndex));
    if (!overlaps) {
      errors.push(
        positional
          ? `${stepLabel(step, i)}: rollback step ${i + 1} does not target fix step ${i + 1}'s resource — refused for safety`
          : `${stepLabel(step, i)}: rollback target is outside every fix-step resource — refused for safety`,
      );
    }
  });
  return errors;
}
