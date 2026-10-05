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
  'iam.roles.create',
  'iam.roles.update',
  'iam.roles.delete',
  'iam.serviceAccounts.create',
  'iam.serviceAccounts.keys.create',
  'iam.serviceAccounts.setIamPolicy',
  'iam.serviceAccountKeys.create',
  'orgpolicy.policies.update',
  'resourcemanager.organizations.setIamPolicy',
  'resourcemanager.folders.setIamPolicy',
];

/** True when the step's method+URL is covered by the class allowlist. */
export function isGcpAllowlistedFixStep(params: {
  assetClass: GcpRemediationAssetClass;
  method: string;
  url: string;
}): boolean {
  return (
    GCP_FIX_FORWARD_ALLOWLIST[params.assetClass]?.some(
      (entry) => entry.method === params.method && params.url.startsWith(entry.urlPrefix),
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
  return (
    GCP_FIX_FORWARD_ALLOWLIST[params.assetClass]?.some((entry) =>
      params.url.startsWith(entry.urlPrefix),
    ) ?? false
  );
}
