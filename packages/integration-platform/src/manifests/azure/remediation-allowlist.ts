import type { AzureRemediationAssetClass } from './remediation-roles';

/**
 * Fix-forward allowlist for Azure remediator service principals
 * (Azure Phase A).
 *
 * These action lists carve the per-class custom role definitions built by
 * `buildAzureCustomRoleDefinition` (consumed by the per-pair setup script
 * in `./remediation-script` and the binding-time trust probe). Anything
 * not listed here is never granted to an executor identity.
 *
 * `AZURE_NEVER_ALLOW_*` additionally lands in every role's `NotActions` /
 * grant-time refusal: in Azure RBAC evaluation an explicit deny wins over
 * any allow, so overlap would silently hollow out coverage — a test in
 * `__tests__/remediation-allowlist.test.ts` asserts the two sets stay
 * disjoint per class.
 *
 * Step-level URL validation against these classes is Phase B work and does
 * not live here.
 */

/** Fix-forward ARM actions granted per class (no wildcards, ever). */
export const AZURE_FIX_FORWARD_ACTIONS: Record<AzureRemediationAssetClass, readonly string[]> = {
  Storage: [
    'Microsoft.Storage/storageAccounts/write',
    'Microsoft.Storage/storageAccounts/blobServices/write',
  ],
  Compute: [
    'Microsoft.Compute/virtualMachines/write',
    'Microsoft.ContainerService/managedClusters/write',
    'Microsoft.ContainerRegistry/registries/write',
  ],
  Network: [
    'Microsoft.Network/networkSecurityGroups/write',
    'Microsoft.Network/virtualNetworks/write',
    'Microsoft.Network/networkWatchers/flowLogs/write',
  ],
  Data: [
    'Microsoft.Sql/servers/write',
    'Microsoft.DBforPostgreSQL/flexibleServers/write',
    'Microsoft.DBforMySQL/flexibleServers/write',
    'Microsoft.DocumentDB/databaseAccounts/write',
  ],
  // Approval-gated: these actions exist so the setup flow is uniform, but
  // the class never auto-executes — a human applies these writes. Key Vault
  // data-plane and Entra/role-assignment changes deliberately have NO role
  // coverage here and stay human-out-of-band.
  'Security-Global': [
    'Microsoft.Security/pricings/write',
    'Microsoft.Insights/diagnosticSettings/write',
    'Microsoft.OperationalInsights/workspaces/write',
    'Microsoft.Resources/subscriptions/resourceGroups/write',
  ],
};

/**
 * Actions that must never appear in an executor grant. Mirrors the
 * detection-side taxonomy in `./checks/entra-id` (`PRIVILEGED_ROLES`,
 * `actionIsHighPrivilege`): identity-plane writes and destructive
 * data-plane deletes stay human-only.
 */
export const AZURE_NEVER_ALLOW_ACTIONS: readonly string[] = [
  'Microsoft.Authorization/roleAssignments/write',
  'Microsoft.Authorization/roleAssignments/delete',
  'Microsoft.Authorization/roleDefinitions/write',
  'Microsoft.Authorization/roleDefinitions/delete',
  'Microsoft.KeyVault/vaults/delete',
  'Microsoft.Resources/subscriptions/write',
];

/**
 * Roles that must never be granted to (or held by) an executor identity.
 * Same set the detection checks flag on humans (`entra-id`
 * `PRIVILEGED_ROLES`, plus the directory roles noted there).
 */
export const AZURE_NEVER_ALLOW_ROLES: readonly string[] = [
  'Owner',
  'Contributor',
  'User Access Administrator',
  'Global Administrator',
  'Privileged Role Administrator',
];

export interface AzureCustomRoleDefinition {
  roleName: string;
  description: string;
  permissions: Array<{
    actions: string[];
    notActions: string[];
    dataActions: string[];
    notDataActions: string[];
  }>;
  assignableScopes: string[];
}

/**
 * Custom role document for one class, scoped to a single subscription.
 * Fix-forward actions are the only allows; the never-allow set lands in
 * `NotActions` so even a future list overlap fails toward deny. No
 * `dataActions` — fixes use ARM control-plane writes only.
 */
export function buildAzureCustomRoleDefinition(params: {
  assetClass: AzureRemediationAssetClass;
  assignableScope: string;
}): AzureCustomRoleDefinition {
  return {
    roleName: `OpenComp Remediator (${params.assetClass})`,
    description: `Fix-forward-only remediation writes for the ${params.assetClass} asset class. Managed by OpenComp; do not assign to humans.`,
    permissions: [
      {
        actions: [...AZURE_FIX_FORWARD_ACTIONS[params.assetClass]],
        notActions: [...AZURE_NEVER_ALLOW_ACTIONS],
        dataActions: [],
        notDataActions: [],
      },
    ],
    assignableScopes: [params.assignableScope],
  };
}

// Re-exported here so `remediation-allowlist` stays a valid import path
// for the Phase B step-allowlist module next to it.
export {
  AZURE_FIX_FORWARD_ALLOWLIST,
  azureRollbackDeletePrefixAllowed,
  isAzureAllowlistedFixStep,
  normalizeAzureUrlForAllowlist,
} from './remediation-step-allowlist';
export type { AzureAllowlistedCall } from './remediation-step-allowlist';
