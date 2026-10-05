import { isDeepStrictEqual } from 'node:util';
import {
  findPriorStateValue,
  getNestedValue,
  type GcpReadStepRef,
  type GcpStepIdentity,
} from './gcp-remediation-prior-state';

/**
 * Every leaf path (`a.b.0.c`) inside a body value, for mask-coverage
 * checks. Arrays expand by index. Returns null when the value is too
 * deep or too wide to verify — callers fail closed on null.
 */
function bodyLeafPaths(value: unknown, base: string): string[] | null {
  const leaves: string[] = [];
  const walk = (current: unknown, path: string, depth: number): boolean => {
    if (depth > 12 || leaves.length > 200) return false;
    if (current !== null && typeof current === 'object') {
      const entries = Array.isArray(current)
        ? current.map((entry, index) => [String(index), entry] as const)
        : Object.entries(current);
      if (entries.length === 0) {
        leaves.push(path);
        return true;
      }
      return entries.every(([key, entry]) =>
        walk(entry, `${path}.${key}`, depth + 1),
      );
    }
    leaves.push(path);
    return true;
  };
  return walk(value, base, 0) ? leaves : null;
}

/**
 * Mask-external body keys for PUT/PATCH rollbacks. The masked-field loop
 * only compares masked paths, so a body value outside the mask would run
 * uncompared — whether the API honors updateMask (extra keys ignored) or
 * applies the full body (extra keys written), it is an unreviewed write
 * either way. A leaf is covered when a mask field names it or an
 * ancestor of it (the masked subtree already proved equal); every other
 * leaf must still equal its pre-fix value. Prior state may split across
 * records, so each leaf resolves on its own like masked fields do.
 */
export function validateMaskExternalBodyKeys(args: {
  body: Record<string, unknown>;
  fields: string[];
  prefix: string;
  method: string;
  previousState?: Record<string, unknown>;
  readSteps?: GcpReadStepRef[];
  fixStep?: GcpStepIdentity;
}): string[] {
  const { body, fields, prefix, method, previousState } = args;
  for (const key of Object.keys(body)) {
    if (fields.includes(key)) continue;
    const leaves = bodyLeafPaths(body[key], key);
    if (!leaves) {
      return [
        `${prefix}: ${method} rollback body carries "${key}" outside updateMask in a shape too complex to verify — refused for safety`,
      ];
    }
    for (const leaf of leaves) {
      if (
        fields.some((field) => leaf === field || leaf.startsWith(`${field}.`))
      ) {
        continue;
      }
      const prior = findPriorStateValue(previousState, leaf, {
        ...(args.readSteps ? { readSteps: args.readSteps } : {}),
        ...(args.fixStep ? { fixStep: args.fixStep } : {}),
      });
      if (
        !prior ||
        !isDeepStrictEqual(getNestedValue(body, leaf), prior.value)
      ) {
        return [
          `${prefix}: ${method} rollback body carries "${leaf}" outside updateMask with no matching pre-fix value — refused for safety`,
        ];
      }
    }
  }
  return [];
}
