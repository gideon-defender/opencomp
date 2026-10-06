/**
 * Step-URL helpers for Azure plan validation (Azure Phase B).
 *
 * Split from `azure-plan-step-validation` to respect the 300-line repo
 * limit (GCP precedent: `gcp-remediation-step-url`). Pure functions only —
 * no NestJS, no database.
 */

/**
 * Effective URL of a plan step: the executor merges `queryParams` into
 * `url` before sending, so validation must see the same string the
 * wire sees (notably `?api-version=`). Unparseable input returns the raw
 * URL — downstream normalization fails closed on it.
 */
export function buildEffectiveAzureStepUrl(step: {
  url: string;
  queryParams?: Record<string, string>;
}): string {
  try {
    const parsed = new URL(step.url);
    for (const [key, value] of Object.entries(step.queryParams ?? {})) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    return step.url;
  }
}

/**
 * Path segments of a URL pathname with percent-encoding fully resolved
 * (decode-until-stable, mirroring the allowlist normalizer), or undefined
 * when a segment is undecodable. Scope checks MUST use this — matching
 * the raw pathname lets `%73ubscriptions` / `%72esourceGroups` dodge
 * the subscription and resource-group pins while the normalizer (and
 * the wire) resolve them to the victim scope.
 */
export function splitDecodedPathSegments(
  pathname: string,
): string[] | undefined {
  const out: string[] = [];
  for (const segment of pathname.split('/')) {
    let decoded = segment;
    for (let i = 0; i < 4; i++) {
      let next: string;
      try {
        next = decodeURIComponent(decoded);
      } catch {
        return undefined;
      }
      if (next === decoded) break;
      decoded = next;
    }
    if (decoded.includes('%')) return undefined;
    out.push(decoded);
  }
  return out;
}

/**
 * Sorted `[[key, value]]` entries of a URL's query string, or null when
 * the URL carries none. Sorting keeps semantically identical param orders
 * equal. Unparseable URLs yield null — guards elsewhere fail closed on
 * them, and pins comparing here must stay total.
 */
export function sortedQueryEntries(
  url: string,
): Array<[string, string]> | null {
  try {
    const entries = [...new URL(url).searchParams.entries()];
    if (entries.length === 0) return null;
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries;
  } catch {
    return null;
  }
}

/**
 * Subscription id from a step URL's `/subscriptions/{id}` segment
 * (case-insensitive), or undefined when the URL carries no subscription
 * scope (Graph calls, tenant-level paths, garbage).
 */
export function extractAzureStepSubscriptionId(
  url: string,
): string | undefined {
  try {
    const segments = splitDecodedPathSegments(new URL(url).pathname);
    if (!segments) return undefined;
    const at = segments.findIndex(
      (segment) => segment.toLowerCase() === 'subscriptions',
    );
    const id = at >= 0 ? segments[at + 1] : undefined;
    return id || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resource-group name from an ARM id's `/resourceGroups/{name}` segment
 * (case-insensitive), or undefined when the id carries no resource group
 * (subscription-scoped findings, Graph ids, garbage).
 */
export function extractAzureResourceGroup(
  resourceId: string,
): string | undefined {
  try {
    const segments = splitDecodedPathSegments(
      new URL(
        resourceId.startsWith('http')
          ? resourceId
          : `https://management.azure.com${resourceId.startsWith('/') ? '' : '/'}${resourceId}`,
      ).pathname,
    );
    if (!segments) return undefined;
    const at = segments.findIndex(
      (segment) => segment.toLowerCase() === 'resourcegroups',
    );
    const name = at >= 0 ? segments[at + 1] : undefined;
    return name || undefined;
  } catch {
    return undefined;
  }
}
