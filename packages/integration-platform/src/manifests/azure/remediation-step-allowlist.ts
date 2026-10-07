import type { AzureRemediationAssetClass } from './remediation-roles';

/**
 * Fix-forward URL allowlist for Azure remediator plan steps
 * (Azure Phase B).
 *
 * Mirrors `../gcp/remediation-allowlist` (`GCP_FIX_FORWARD_ALLOWLIST`):
 * per-class ARM method+prefix pairs that an auto-fix step may call.
 * Anything not listed here fails closed to guided-only at preview and
 * throws at execute — the executor's denylist (`validateAzurePlanSteps`)
 * stays as the second layer, never the only one.
 *
 * Prefixes are canonical match strings: lowercase
 * `https://management.azure.com/<scope-stripped path>`, where the
 * variable `/subscriptions/{id}[/resourceGroups/{name}]` scope head is
 * removed by `normalizeAzureUrlForAllowlist` before matching. ARM paths
 * are case-insensitive, so matching is case-insensitive by construction.
 * Subscription pinning is NOT done here — the API validator binds each
 * step's subscription to the finding's subscription separately.
 *
 * No POST entries: fix writes are PATCH (merge) or PUT (create/replace).
 * Action-invocation POSTs (`.../stop`, `.../start`, `.../register`,
 * `.../listKeys`) never auto-run. DELETE is rollback-only and matched
 * prefix-only via `azureRollbackDeletePrefixAllowed`.
 */
export interface AzureAllowlistedCall {
  method: 'PATCH' | 'PUT';
  urlPrefix: string;
}

/** Fix-forward ARM calls per class (no wildcards, ever). */
export const AZURE_FIX_FORWARD_ALLOWLIST: Record<
  AzureRemediationAssetClass,
  readonly AzureAllowlistedCall[]
> = {
  Storage: [
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.storage/storageaccounts',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.storage/storageaccounts',
    },
  ],
  Compute: [
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.compute/virtualmachines',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.compute/virtualmachines',
    },
    {
      method: 'PATCH',
      urlPrefix:
        'https://management.azure.com/providers/microsoft.containerservice/managedclusters',
    },
    {
      method: 'PUT',
      urlPrefix:
        'https://management.azure.com/providers/microsoft.containerservice/managedclusters',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.containerregistry/registries',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.containerregistry/registries',
    },
  ],
  Network: [
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.network/networksecuritygroups',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.network/networksecuritygroups',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.network/virtualnetworks',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.network/virtualnetworks',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.network/networkwatchers',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.network/networkwatchers',
    },
  ],
  Data: [
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.sql/servers',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.sql/servers',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.dbforpostgresql/flexibleservers',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.dbforpostgresql/flexibleservers',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.dbformysql/flexibleservers',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.dbformysql/flexibleservers',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.documentdb/databaseaccounts',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.documentdb/databaseaccounts',
    },
  ],
  // Approval-gated: entries exist so the setup flow and prompt rendering
  // stay uniform, but the class never auto-executes — preview refuses
  // gated classes before any allowlist check runs.
  'Security-Global': [
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.security/pricings',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.insights/diagnosticsettings',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.insights/activitylogalerts',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/providers/microsoft.operationalinsights/workspaces',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://management.azure.com/resourcegroups',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://management.azure.com/providers/microsoft.security/pricings',
    },
  ],
};

const AZURE_MANAGEMENT_HOST = 'management.azure.com';

/**
 * Canonical form of an ARM step URL for allowlist matching:
 * `https://management.azure.com/<scope-stripped lowercase path>`.
 *
 * Normalization discipline (mirrors `normalizeGcpUrlForAllowlist`):
 * https-only, management-host-only, percent-decode until stable
 * (defeats `%72oleAssignments` and double-encoding), leftover `%`
 * fails closed, dot-segments resolved (`..` above root fails closed),
 * query and fragment dropped (api-version never affects the match).
 * Returns undefined when the URL is unparseable or undecodable —
 * callers fail closed, never pass.
 */
export function normalizeAzureUrlForAllowlist(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') return undefined;
  if (parsed.hostname.toLowerCase() !== AZURE_MANAGEMENT_HOST) {
    return undefined;
  }
  let path = parsed.pathname;
  for (let i = 0; i < 4; i++) {
    let next: string;
    try {
      next = decodeURIComponent(path);
    } catch {
      return undefined;
    }
    if (next === path) break;
    path = next;
  }
  if (path.includes('%')) return undefined;
  const resolved: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const popped = resolved.pop();
      if (popped === undefined) return undefined;
      continue;
    }
    resolved.push(segment.toLowerCase());
  }
  // Strip the variable scope head: /subscriptions/{id} plus the
  // optional /resourceGroups/{name} — but only when resource path
  // segments follow it. A bare /resourceGroups/{name} (resource-group
  // create) keeps its head so the `resourcegroups` prefix can match it.
  let rest = resolved;
  if (rest[0] === 'subscriptions') {
    if (!rest[1]) return undefined;
    rest = rest.slice(2);
    if (rest[0] === 'resourcegroups' && rest[1] && rest.length > 2) {
      rest = rest.slice(2);
    }
  }
  if (rest.length === 0) return undefined;
  return `https://${AZURE_MANAGEMENT_HOST}/${rest.join('/')}`;
}

/**
 * True when a fix step calls an allowlisted ARM endpoint for its class:
 * exact method plus segment-boundary prefix match on the normalized URL.
 * Any normalization failure returns false.
 */
export function isAzureAllowlistedFixStep(args: {
  assetClass: AzureRemediationAssetClass;
  method: string;
  url: string;
}): boolean {
  const normalized = normalizeAzureUrlForAllowlist(args.url);
  if (!normalized) return false;
  const entries = AZURE_FIX_FORWARD_ALLOWLIST[args.assetClass];
  if (!entries) return false;
  return entries.some(
    (entry) =>
      entry.method === args.method &&
      (normalized === entry.urlPrefix || normalized.startsWith(`${entry.urlPrefix}/`)),
  );
}

/**
 * Rollback-only DELETE scope: true when the URL falls under one of the
 * class's allowlisted prefixes, regardless of method. Callers enforce
 * that DELETE only runs as a rollback step — this function only answers
 * "is the target inside the class's fix-forward surface".
 */
export function azureRollbackDeletePrefixAllowed(args: {
  assetClass: AzureRemediationAssetClass;
  url: string;
}): boolean {
  const normalized = normalizeAzureUrlForAllowlist(args.url);
  if (!normalized) return false;
  const entries = AZURE_FIX_FORWARD_ALLOWLIST[args.assetClass];
  if (!entries) return false;
  return entries.some(
    (entry) => normalized === entry.urlPrefix || normalized.startsWith(`${entry.urlPrefix}/`),
  );
}
