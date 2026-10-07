import { collectLeafPaths } from './azure-remediation-plan.utils';

/** Origin plus pathname of a step URL, lowercased: the resource identity
 * for verify attribution. Query params (`api-version` especially) select
 * behavior, not resources, so they never split identity. */
function stepResourcePath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Written leaf paths per read-step purpose: a fix step's paths attribute
 * to every read purpose whose resource it targets — the step's own path
 * or a sub-path of the read (an NSG rule PUT verifies against its parent
 * NSG re-read). A fix with no read coverage verifies against nothing:
 * without a re-read there is no evidence.
 */
export function azureFixWrittenPathsByPurpose(args: {
  fixSteps: Array<{ body?: unknown; url: string }>;
  readSteps: Array<{ url: string; purpose: string }>;
}): Record<string, string[]> {
  const reads = new Map<string, string>();
  for (const read of args.readSteps) {
    const path = stepResourcePath(read.url);
    if (path) reads.set(read.purpose, path);
  }
  const out = new Map<string, Set<string>>();
  for (const step of args.fixSteps) {
    const target = stepResourcePath(step.url);
    if (!target) continue;
    for (const path of collectLeafPaths(step.body)) {
      for (const [purpose, readPath] of reads) {
        if (target === readPath || target.startsWith(`${readPath}/`)) {
          let paths = out.get(purpose);
          if (!paths) {
            paths = new Set<string>();
            out.set(purpose, paths);
          }
          paths.add(path);
        }
      }
    }
  }
  return Object.fromEntries(
    [...out.entries()].map(([purpose, paths]) => [purpose, [...paths]]),
  );
}
