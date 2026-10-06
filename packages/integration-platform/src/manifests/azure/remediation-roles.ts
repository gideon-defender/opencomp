/**
 * Asset-class x subscription remediator service principals (Azure Phase A).
 *
 * Mirrors `../gcp/remediation-roles` for GCP: the auditor (scan) identity is
 * the user's OAuth token with read-only roles, while fixes execute only via
 * customer-owned per-class service principals holding narrow custom role
 * definitions (see `./remediation-allowlist`).
 *
 * Azure has no STS-AssumeRole / `generateAccessToken` equivalent for
 * minting a scoped-down token from a user token, so there is no short-lived
 * impersonation here: the app authenticates as the class SP directly
 * (client-credentials flow) per execution. The standing secret is the
 * accepted residual risk, compensated by vault-only storage, a trust probe
 * that proves the SP cannot self-elevate, and detection that attributes
 * every executor write to the SP object ID (Phase C).
 *
 * No SP secret is ever persisted next to the map — the vault stores only
 * the `Class:subscription -> SP application (client) ID` map (see
 * `parseAzureRemediationMap`); secrets are stored as separate vault values
 * at binding time.
 */

export const AZURE_REMEDIATION_ASSET_CLASSES = [
  'Storage',
  'Compute',
  'Network',
  'Data',
  'Security-Global',
] as const;

export type AzureRemediationAssetClass = (typeof AZURE_REMEDIATION_ASSET_CLASSES)[number];

/**
 * Asset classes that never auto-execute. Findings routing here return
 * guided-only manual steps from preview, and execute/rollback refuse even
 * when a remediator SP is bound — a human applies these writes.
 * `Security-Global` holds identity and secrets writes (Entra roles, role
 * assignments, Key Vault); `Network` controls traffic paths (NSGs, VNets)
 * where a wrong apply cuts connectivity.
 */
export const APPROVAL_GATED_AZURE_ASSET_CLASSES: readonly AzureRemediationAssetClass[] = [
  'Network',
  'Security-Global',
];

export function isApprovalGatedAzureAssetClass(assetClass: AzureRemediationAssetClass): boolean {
  return (APPROVAL_GATED_AZURE_ASSET_CLASSES as readonly string[]).includes(assetClass);
}

/** Azure subscription IDs are GUIDs. */
export const SAFE_AZURE_SUBSCRIPTION_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Service-principal application (client) ID shape (a GUID). */
export const AZURE_REMEDIATOR_SP_APP_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remediator SP display-name prefix (per class, see below). */
export const AZURE_REMEDIATOR_SP_NAME_PREFIX = 'opencomp-remediator';

/** Display name for a class SP, e.g. `opencomp-remediator-storage`. */
export function azureRemediatorSpName(params: { assetClass: AzureRemediationAssetClass }): string {
  return `${AZURE_REMEDIATOR_SP_NAME_PREFIX}-${params.assetClass.toLowerCase()}`;
}

/**
 * Finding `resourceType` (see `IntegrationCheckResult.resourceType`) to
 * asset class. Covers the measured `azure-*` types from the
 * integration-platform checks plus near-future types so new checks route
 * without a roles change. Coarse subscription-scoped types
 * (`azure-subscription`, `azure-environment-separation`) route to
 * `Security-Global` — the human-gated class — and unknown types fail
 * closed there too, so a future check type lands in manual approval
 * instead of silently auto-fixing.
 */
const AZURE_RESOURCE_TYPE_TO_ASSET_CLASS: Record<string, AzureRemediationAssetClass> = {
  'azure-storage-account': 'Storage',
  'azure-virtual-machine': 'Compute',
  'azure-kubernetes-service': 'Compute',
  'azure-container-registry': 'Compute',
  'azure-nsg': 'Network',
  'azure-virtual-network': 'Network',
  'azure-firewall': 'Network',
  'azure-route-table': 'Network',
  'azure-sql-server': 'Data',
  'azure-postgresql-flexible-server': 'Data',
  'azure-mysql-flexible-server': 'Data',
  'azure-cosmosdb-account': 'Data',
  'azure-key-vault': 'Security-Global',
  'azure-role-definition': 'Security-Global',
  'azure-subscription': 'Security-Global',
  'azure-environment-separation': 'Security-Global',
  'azure-entra-user': 'Security-Global',
  'azure-policy-assignment': 'Security-Global',
};

export function azureFindingToAssetClass(resourceType: unknown): AzureRemediationAssetClass {
  if (typeof resourceType !== 'string') return 'Security-Global';
  if (!Object.prototype.hasOwnProperty.call(AZURE_RESOURCE_TYPE_TO_ASSET_CLASS, resourceType)) {
    // Family fallback for types added without a roles change.
    const lower = resourceType.toLowerCase();
    if (
      lower.includes('firewall') ||
      lower.includes('network') ||
      lower.includes('nsg') ||
      lower.includes('vnet') ||
      lower.includes('route')
    )
      return 'Network';
    if (lower.includes('storage') || lower.includes('bucket')) return 'Storage';
    if (
      lower.includes('sql') ||
      lower.includes('postgres') ||
      lower.includes('mysql') ||
      lower.includes('cosmos')
    )
      return 'Data';
    if (
      lower.includes('compute') ||
      lower.includes('vm') ||
      lower.includes('aks') ||
      lower.includes('kubernetes') ||
      lower.includes('container')
    )
      return 'Compute';
    return 'Security-Global';
  }
  return AZURE_RESOURCE_TYPE_TO_ASSET_CLASS[resourceType];
}

// Re-exported here so `remediation-roles` stays the single import path.
export {
  AZURE_FIX_FORWARD_ACTIONS,
  AZURE_NEVER_ALLOW_ACTIONS,
  AZURE_NEVER_ALLOW_ROLES,
  buildAzureCustomRoleDefinition,
} from './remediation-allowlist';
export type { AzureCustomRoleDefinition } from './remediation-allowlist';
export {
  MAX_AZURE_REMEDIATION_PAIRS,
  azureRemediationKey,
  getAzureRemediationMapParseError,
  isAzureRemediationKey,
  normalizeAzureRemediationKey,
  parseAzureRemediationKey,
  parseAzureRemediationMap,
  parseAzureRemediationSecrets,
  serializeAzureRemediationMap,
} from './remediation-bindings';
