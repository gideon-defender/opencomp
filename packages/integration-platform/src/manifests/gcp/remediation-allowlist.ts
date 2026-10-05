/**
 * Per-asset-class fix-forward allowlists for GCP (Phase 1).
 *
 * Mirrors `../aws/remediation-allowlist` for AWS: each entry is a
 * `{ method, urlPrefix }` pair the fix executor may call. Anything not on
 * the class list is refused pre-execution and degrades to guided-only —
 * including AI-generated steps. `GCP_NEVER_ALLOW_PERMISSIONS` names GCP
 * permissions that must never appear in a fix plan (IAM writes,
 * org-policy mutation, deletions outside rollback).
 */
import type { GcpRemediationAssetClass } from './remediation-roles';

export interface GcpAllowlistedCall {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** URL prefix (origin + path start) a fix/rollback step must start with. */
  urlPrefix: string;
}

export const GCP_FIX_FORWARD_ALLOWLIST: Record<
  GcpRemediationAssetClass,
  readonly GcpAllowlistedCall[]
> = {
  Storage: [
    {
      method: 'PATCH',
      urlPrefix: 'https://storage.googleapis.com/storage/v1/b/',
    },
    {
      method: 'POST',
      urlPrefix: 'https://storage.googleapis.com/storage/v1/b/',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://storage.googleapis.com/storage/v1/b/',
    },
  ],
  Compute: [
    {
      method: 'POST',
      urlPrefix: 'https://compute.googleapis.com/compute/v1/projects/',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://compute.googleapis.com/compute/v1/projects/',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://compute.googleapis.com/compute/v1/projects/',
    },
  ],
  Network: [
    {
      method: 'POST',
      urlPrefix: 'https://compute.googleapis.com/compute/v1/projects/',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://compute.googleapis.com/compute/v1/projects/',
    },
    {
      method: 'POST',
      urlPrefix: 'https://dns.googleapis.com/dns/v1/projects/',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://dns.googleapis.com/dns/v1/projects/',
    },
  ],
  Data: [
    {
      method: 'PATCH',
      urlPrefix: 'https://sqladmin.googleapis.com/v1/projects/',
    },
    {
      method: 'POST',
      urlPrefix: 'https://sqladmin.googleapis.com/v1/projects/',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://bigquery.googleapis.com/bigquery/v2/projects/',
    },
    {
      method: 'POST',
      urlPrefix: 'https://pubsub.googleapis.com/v1/projects/',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://pubsub.googleapis.com/v1/projects/',
    },
  ],
  'Security-Global': [
    {
      method: 'POST',
      urlPrefix: 'https://cloudkms.googleapis.com/v1/projects/',
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://cloudkms.googleapis.com/v1/projects/',
    },
    {
      method: 'POST',
      urlPrefix: 'https://monitoring.googleapis.com/v3/projects/',
    },
    {
      method: 'PUT',
      urlPrefix: 'https://monitoring.googleapis.com/v3/projects/',
    },
  ],
};

/**
 * GCP permissions that must never appear in a fix plan. Belt-and-suspenders
 * over the URL allowlist: even if a future allowlist addition is too broad,
 * plans touching these permissions are refused. Mirrors
 * `NEVER_ALLOW_REMEDIATION_ACTIONS` for AWS.
 */
export const GCP_NEVER_ALLOW_PERMISSIONS: readonly string[] = [
  'resourcemanager.projects.setIamPolicy',
  'resourcemanager.projects.delete',
  'resourcemanager.organizations.setIamPolicy',
  'resourcemanager.folders.setIamPolicy',
  'iam.roles.create',
  'iam.roles.update',
  'iam.roles.delete',
  'iam.serviceAccounts.create',
  'iam.serviceAccounts.delete',
  'iam.serviceAccounts.keys.create',
  'iam.serviceAccounts.setIamPolicy',
  'iam.serviceAccountKeys.create',
  'orgpolicy.policies.update',
  'compute.instances.delete',
  'compute.firewalls.delete',
  'compute.disks.delete',
  'storage.buckets.delete',
  'sql.instances.delete',
  'bigquery.datasets.delete',
];

/**
 * IAM roles that must never be granted by a fix plan to any principal.
 * Public-grant checks catch `allUsers`, but a grant of `roles/owner` to a
 * single attacker address is the same escalation under a narrower name.
 * Role-administration, impersonation, and key-creation roles escalate
 * without ever touching `owner`/`editor`, so they are denied too — as are
 * the service-admin roles (`compute.admin`, `storage.admin`), which grant
 * full control over their services' data. BigQuery dataset `access`
 * entries use legacy `OWNER`/`WRITER` values instead of `roles/*`
 * strings, so those spellings are denied alongside their IAM equivalents.
 * Paths with a dedicated removal-only validator (IAM, bucket bindings)
 * already refuse these; this list is the backstop for the generic paths.
 */
export const GCP_NEVER_ALLOW_ROLES: readonly string[] = [
  'roles/owner',
  'roles/editor',
  'roles/resourcemanager.organizationAdmin',
  'roles/resourcemanager.projectIamAdmin',
  'roles/iam.roleAdmin',
  'roles/iam.securityAdmin',
  'roles/iam.serviceAccountAdmin',
  'roles/iam.serviceAccountKeyAdmin',
  'roles/iam.serviceAccountTokenCreator',
  'roles/iam.serviceAccountUser',
  'roles/compute.admin',
  'roles/storage.admin',
  'roles/bigquery.admin',
  'roles/bigquery.dataOwner',
  'OWNER',
  'WRITER',
];

/** True when the step's method+URL is covered by the class allowlist. */
export function isGcpAllowlistedFixStep(params: {
  assetClass: GcpRemediationAssetClass;
  method: string;
  url: string;
}): boolean {
  const normalized = normalizeGcpUrlForAllowlist(params.url);
  if (!normalized) return false;
  return (
    GCP_FIX_FORWARD_ALLOWLIST[params.assetClass]?.some(
      (entry) => entry.method === params.method && normalized.startsWith(entry.urlPrefix),
    ) ?? false
  );
}

/**
 * True when a rollback DELETE targets one of the class's own API prefixes
 * (method ignored). Rollback plans may need DELETE to undo a created
 * resource, but the URL must still sit under an allowlisted API — a blanket
 * DELETE pass would let an AI-generated rollback hit any Google API.
 */
export function gcpRollbackDeletePrefixAllowed(params: {
  assetClass: GcpRemediationAssetClass;
  url: string;
}): boolean {
  const normalized = normalizeGcpUrlForAllowlist(params.url);
  if (!normalized) return false;
  return (
    GCP_FIX_FORWARD_ALLOWLIST[params.assetClass]?.some((entry) =>
      normalized.startsWith(entry.urlPrefix),
    ) ?? false
  );
}

/**
 * Decode a URL pathname to a fixed point (up to 4 rounds). WHATWG keeps
 * escapes like `%3A` encoded, but the server routes the decoded form — a
 * single decode lets double-encoding (`%253A`) split one guard from
 * another. Returns `undefined` when the path is not decodable; callers
 * fail closed.
 *
 * Single canonical implementation: the allowlist normalizer below and the
 * API validators (via the package barrel) must all decode through this
 * function so guards cannot disagree on what a path means.
 */
export function decodeGcpPathnameToFixedPoint(pathname: string): string | undefined {
  try {
    let decoded = pathname;
    for (let i = 0; i < 4; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    return decoded;
  } catch {
    return undefined;
  }
}

/**
 * Resolve dot-segments of an already-decoded pathname into its segment
 * stack. Shared by the allowlist normalizer and the API validators so a
 * fix to traversal handling lands in one place. Callers format the stack
 * (trailing-slash handling differs per use).
 */
export function splitGcpPathSegments(pathname: string): string[] {
  const stack: string[] = [];
  for (const segment of pathname.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack;
}

/**
 * Normalize a step URL for allowlist comparison: decode percent-encoding
 * to a fixed point then resolve dot-segments so `.../b/x/../../compute/...`
 * (or its double-encoded `%252e%252e` form) cannot pass a string-prefix
 * check while the server routes outside the prefix. The port is preserved:
 * dropping it would let `https://host:8443/...` normalize to the
 * allowlisted `:443` form while the fetch goes elsewhere.
 * Returns `undefined` when the URL is not parseable — callers fail closed.
 */
function normalizeGcpUrlForAllowlist(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    const host = parsed.host.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'googleapis.com' && !hostname.endsWith('.googleapis.com')) {
      return undefined;
    }
    const decoded = decodeGcpPathnameToFixedPoint(parsed.pathname);
    if (decoded === undefined) return undefined;
    const trailingSlash = decoded.endsWith('/');
    const normalizedPath = `/${splitGcpPathSegments(decoded).join('/')}${trailingSlash ? '/' : ''}`;
    return `https://${host}${normalizedPath}`;
  } catch {
    return undefined;
  }
}
