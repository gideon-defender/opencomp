/**
 * Asset-class x project remediator service accounts (GCP Phase 1).
 *
 * Mirrors `../aws/remediation-roles` for AWS: the auditor (scan) identity is
 * the user's OAuth token with read-only roles, while fixes execute only via
 * short-lived impersonated tokens for a customer-owned remediator service
 * account (`opencomp-remediator@<project>.iam.gserviceaccount.com`).
 *
 * No remediator token or key material is ever persisted — the vault stores
 * only the `Class:project -> SA email` map (see `parseGcpRemediationMap`),
 * and tokens are minted per execution with a ≤1h TTL.
 */

export const GCP_REMEDIATION_ASSET_CLASSES = [
  'Storage',
  'Compute',
  'Network',
  'Data',
  'Security-Global',
] as const;

export type GcpRemediationAssetClass = (typeof GCP_REMEDIATION_ASSET_CLASSES)[number];

/**
 * Maximum `Class:project` bindings stored on one connection. Each binding
 * costs two impersonation probes (backend + auditor) at save time, so an
 * unbounded map turns one request into unbounded outbound calls.
 */
export const MAX_GCP_REMEDIATION_PAIRS = 50;

/**
 * Asset classes that never auto-execute. Findings routing here return
 * guided-only manual steps from preview, and execute/rollback refuse even
 * when a remediator SA is bound — a human applies these writes.
 * `Security-Global` holds the highest-blast-radius writes (IAM policy,
 * KMS, org policy); `Network` controls traffic paths (firewalls, routes,
 * DNS) where a wrong apply cuts connectivity.
 */
export const APPROVAL_GATED_GCP_ASSET_CLASSES: readonly GcpRemediationAssetClass[] = [
  'Network',
  'Security-Global',
];

export function isApprovalGatedGcpAssetClass(assetClass: GcpRemediationAssetClass): boolean {
  return (APPROVAL_GATED_GCP_ASSET_CLASSES as readonly string[]).includes(assetClass);
}

/** GCP project IDs: 6-30 chars, lowercase letters/digits/hyphens, start with a letter. */
export const SAFE_GCP_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** Service-account email shape for the remediator SA. */
export const GCP_REMEDIATOR_SA_EMAIL_PATTERN = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;

/** Remediator SA account id (prefix before @). */
export const GCP_REMEDIATOR_SA_NAME = 'opencomp-remediator';

/**
 * Finding `resourceType` (see `IntegrationCheckResult.resourceType`) to
 * asset class. Covers the `gcp-*` kebab types from the integration-platform
 * checks. Unknown types route to `Security-Global` — the human-gated class —
 * so a future check type fails closed to manual approval instead of
 * silently landing in an auto-fix class.
 */
const GCP_RESOURCE_TYPE_TO_ASSET_CLASS: Record<string, GcpRemediationAssetClass> = {
  // Native checks (integration-platform manifests).
  'gcp-storage-bucket': 'Storage',
  'gcp-cloud-sql-instance': 'Data',
  'gcp-firewall-rule': 'Network',
  'gcp-compute-instance': 'Compute',
  'gcp-compute-network': 'Network',
  'gcp-vpc-network': 'Network',
  'gcp-bigquery-dataset': 'Data',
  'gcp-pubsub-topic': 'Data',
  'gcp-kms-key': 'Security-Global',
  'gcp-iam-binding': 'Security-Global',
  'gcp-logging-sink': 'Security-Global',
  'gcp-monitoring-policy': 'Security-Global',
  'gcp-dns-zone': 'Network',
  'gcp-project': 'Security-Global',
  'gcp-environment-separation': 'Security-Global',
  // SCC-sourced families (prefix match handled in the router below).
  'gcp-scc-storage': 'Storage',
  'gcp-scc-compute': 'Compute',
  'gcp-scc-network': 'Network',
  'gcp-scc-data': 'Data',
};

export function gcpFindingToAssetClass(resourceType: unknown): GcpRemediationAssetClass {
  if (typeof resourceType !== 'string') return 'Security-Global';
  if (!Object.prototype.hasOwnProperty.call(GCP_RESOURCE_TYPE_TO_ASSET_CLASS, resourceType)) {
    // SCC category strings arrive as full paths/names — match on family.
    const lower = resourceType.toLowerCase();
    if (lower.includes('firewall') || lower.includes('network')) return 'Network';
    if (lower.includes('storage') || lower.includes('bucket')) return 'Storage';
    if (lower.includes('sql') || lower.includes('bigquery') || lower.includes('pubsub'))
      return 'Data';
    if (lower.includes('compute') || lower.includes('gke')) return 'Compute';
    return 'Security-Global';
  }
  return GCP_RESOURCE_TYPE_TO_ASSET_CLASS[resourceType];
}

/** Custom role id for a class, e.g. `opencomp.remediator.storage`. */
export function gcpRemediationRoleId(params: { assetClass: GcpRemediationAssetClass }): string {
  const suffix =
    params.assetClass === 'Security-Global' ? 'securityGlobal' : params.assetClass.toLowerCase();
  return `opencomp.remediator.${suffix}`;
}

/** Expected remediator SA email for a project. */
export function gcpRemediationSaEmail(params: { projectId: string }): string {
  const projectId = params.projectId.trim();
  if (!SAFE_GCP_PROJECT_PATTERN.test(projectId)) {
    throw new Error(
      `gcpRemediationSaEmail requires a valid GCP project id, got "${params.projectId}"`,
    );
  }
  return `${GCP_REMEDIATOR_SA_NAME}@${projectId}.iam.gserviceaccount.com`;
}

/**
 * Credential-map key for a pair, e.g. `Storage:my-proj`.
 */
export function gcpRemediationKey(params: {
  assetClass: GcpRemediationAssetClass;
  projectId: string;
}): string {
  const projectId = params.projectId.trim();
  if (!SAFE_GCP_PROJECT_PATTERN.test(projectId)) {
    throw new Error(`gcpRemediationKey requires a valid GCP project id, got "${params.projectId}"`);
  }
  return `${params.assetClass}:${projectId}`;
}

/** True when `key` is a well-formed `AssetClass:project` map key. */
export function isGcpRemediationKey(key: string): boolean {
  return normalizeGcpRemediationKey(key) !== undefined;
}

/**
 * Canonical form of a pair-map key (`AssetClass:project`). Trims both
 * halves, so `"Storage: my-proj"` and `"Storage:my-proj"` resolve to the
 * same binding — otherwise a key that passes validation would never match
 * the canonical lookup key minted by `gcpRemediationKey` and the binding
 * would silently degrade to guided-only. Returns undefined when malformed.
 */
export function normalizeGcpRemediationKey(key: string): string | undefined {
  const separator = key.indexOf(':');
  if (separator <= 0) return undefined;
  const assetClass = key.slice(0, separator).trim();
  const projectId = key.slice(separator + 1).trim();
  if (!(GCP_REMEDIATION_ASSET_CLASSES as readonly string[]).includes(assetClass)) {
    return undefined;
  }
  if (!SAFE_GCP_PROJECT_PATTERN.test(projectId)) return undefined;
  return `${assetClass}:${projectId}`;
}

/**
 * Parse the stored `gcpRemediation` credential (a JSON string of
 * `{ "Class:project": "sa-email" }`) into a clean record. Anything else
 * yields `{}` so callers fail closed to guided-only instead of throwing on
 * bad input.
 */
export function parseGcpRemediationMap(value: unknown): Record<string, string> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return {};
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [rawKey, email] of Object.entries(parsed as Record<string, unknown>)) {
    const key = normalizeGcpRemediationKey(rawKey);
    if (!key) continue;
    if (typeof email !== 'string' || !email.trim()) continue;
    const normalized = email.trim().toLowerCase();
    if (!GCP_REMEDIATOR_SA_EMAIL_PATTERN.test(normalized)) continue;
    out[key] = normalized;
  }
  return out;
}

/** Serialize a pair map for credential storage (drops invalid entries). */
export function serializeGcpRemediationMap(map: Record<string, string>): string {
  return JSON.stringify(parseGcpRemediationMap(map));
}

/**
 * Fail-open-safe check for the RAW `gcpRemediation` credential value.
 * Returns an error message for non-empty input that is not a JSON object
 * mapping valid keys to SA emails, or null when absent/blank/valid.
 */
export function getGcpRemediationMapParseError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  let entries: [string, unknown][];
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'gcpRemediation: must be a JSON object mapping "<AssetClass>:<project>" to service-account email.';
      }
      entries = Object.entries(parsed as Record<string, unknown>);
    } catch {
      return 'gcpRemediation: must be a JSON object mapping "<AssetClass>:<project>" to service-account email.';
    }
  } else if (typeof value === 'object' && !Array.isArray(value)) {
    entries = Object.entries(value as Record<string, unknown>);
  } else {
    return 'gcpRemediation: must be a JSON object mapping "<AssetClass>:<project>" to service-account email.';
  }
  if (entries.length === 0) return null;
  if (entries.length > MAX_GCP_REMEDIATION_PAIRS) {
    return `gcpRemediation: too many bindings (${entries.length}). Maximum is ${MAX_GCP_REMEDIATION_PAIRS} — each binding costs two impersonation probes at save time.`;
  }
  const seen = new Set<string>();
  for (const [rawKey, email] of entries) {
    // Compare canonical keys so `"Storage: p"` and `"Storage:p"` count as
    // the same binding (matching `parseGcpRemediationMap`, which stores the
    // canonical form). Otherwise two spellings of one binding would pass
    // here and collapse silently on read.
    const key = normalizeGcpRemediationKey(rawKey);
    if (!key) {
      return `gcpRemediation["${rawKey}"]: keys must be "<AssetClass>:<project>" with a valid GCP project id.`;
    }
    if (seen.has(key)) {
      return `gcpRemediation["${key}"]: duplicate key after trimming whitespace.`;
    }
    seen.add(key);
    if (
      typeof email !== 'string' ||
      !GCP_REMEDIATOR_SA_EMAIL_PATTERN.test(email.trim().toLowerCase())
    ) {
      return `gcpRemediation["${key}"]: must be a service-account email (*.iam.gserviceaccount.com).`;
    }
  }
  return null;
}

// Re-exported here so `remediation-roles` stays the single import path.
export {
  GCP_FIX_FORWARD_ALLOWLIST,
  GCP_NEVER_ALLOW_PERMISSIONS,
  GCP_NEVER_ALLOW_ROLES,
} from './remediation-allowlist';
