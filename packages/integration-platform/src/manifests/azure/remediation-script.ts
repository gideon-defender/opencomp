import { escapeDoubleQuotedShell } from '../aws/remediation-roles';
import {
  SAFE_AZURE_SUBSCRIPTION_PATTERN,
  azureRemediatorSpName,
  buildAzureCustomRoleDefinition,
  type AzureRemediationAssetClass,
} from './remediation-roles';

/**
 * Azure CLI setup scripts for per-class remediator bindings (Azure Phase A).
 *
 * Mirrors `../gcp/remediation-script` for GCP: generates the customer-side
 * commands that create the class service principal, carve the fix-forward
 * custom role definition, and assign the role at subscription scope. Safe
 * to re-run: existing app/SP/role are looked up first and reused, and the
 * role definition is updated in place when it already exists. Only the
 * SP's application (client) ID is pasted back — the secret is shown once
 * by `az` at creation and stored directly in the connection vault.
 */

export interface AzureRemediationScriptPair {
  assetClass: AzureRemediationAssetClass;
  subscriptionId: string;
}

/**
 * Azure CLI setup script for ONE class x subscription remediator binding.
 * Prints the `Class:subscription -> SP app ID` map entry at the end for
 * paste-back into the connection settings.
 */
export function getAzureRemediationScriptForPair(params: {
  pair: AzureRemediationScriptPair;
}): string {
  const subscriptionId = params.pair.subscriptionId.trim();
  if (!SAFE_AZURE_SUBSCRIPTION_PATTERN.test(subscriptionId)) {
    throw new Error(
      `getAzureRemediationScriptForPair requires a valid Azure subscription id, got "${params.pair.subscriptionId}"`,
    );
  }
  const spName = azureRemediatorSpName({ assetClass: params.pair.assetClass });
  const role = buildAzureCustomRoleDefinition({
    assetClass: params.pair.assetClass,
    assignableScope: `/subscriptions/${subscriptionId}`,
  });
  // Defense in depth: subscription and names are pattern-generated above,
  // but every interpolated value is still escaped — the generated script
  // runs with the customer's subscription-owner privileges in Cloud Shell.
  const safeSubscription = escapeDoubleQuotedShell(subscriptionId);
  const safeSpName = escapeDoubleQuotedShell(spName);
  const safeRoleName = escapeDoubleQuotedShell(role.roleName);
  // Single-quoted JSON blob: the role document contains double quotes
  // throughout, so it must never land inside a double-quoted shell string.
  const roleJson = JSON.stringify(
    {
      Name: null,
      IsCustom: true,
      Description: role.description,
      Actions: role.permissions[0].actions,
      NotActions: role.permissions[0].notActions,
      DataActions: role.permissions[0].dataActions,
      NotDataActions: role.permissions[0].notDataActions,
      AssignableScopes: role.assignableScopes,
    },
    null,
    2,
  );
  const approvalNote =
    params.pair.assetClass === 'Network' || params.pair.assetClass === 'Security-Global'
      ? '# NOTE: this class is approval-gated — fixes stay guided-only until a human approves.\n'
      : '';

  return `# Remediator binding ${params.pair.assetClass}:${subscriptionId} (fix-forward only)
# Run in Cloud Shell with subscription Owner on ${subscriptionId}. Safe to re-run.
# Only the SP application ID below is pasted back — store the shown-once secret in the connection vault.
(
set -euo pipefail

SUBSCRIPTION="${safeSubscription}"
SP_NAME="${safeSpName}"
ROLE_NAME="${safeRoleName}"
SCOPE="/subscriptions/$SUBSCRIPTION"

APP_ID=$(az ad app list --display-name "$SP_NAME" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name "$SP_NAME" --query "appId" -o tsv)
fi

SP_OBJECT_ID=$(az ad sp list --display-name "$SP_NAME" --query "[0].id" -o tsv)
if [ -z "$SP_OBJECT_ID" ]; then
  SP_OBJECT_ID=$(az ad sp create --id "$APP_ID" --query "id" -o tsv)
fi

ROLE_FILE=$(mktemp /tmp/opencomp-role-XXXXXX.json)
cat > "$ROLE_FILE" <<'ROLEEOF'
${roleJson}
ROLEEOF
EXISTING_ROLE=$(az role definition list --custom-role-only true --query "[?roleName=='$ROLE_NAME'].name | [0]" -o tsv)
if [ -z "$EXISTING_ROLE" ]; then
  az role definition create --role-definition "$ROLE_FILE"
else
  az role definition update --role-definition "$ROLE_FILE"
fi
rm -f "$ROLE_FILE"

ASSIGNMENT=$(az role assignment list --assignee "$SP_OBJECT_ID" --role "$ROLE_NAME" --scope "$SCOPE" --query "[0].id" -o tsv)
if [ -z "$ASSIGNMENT" ]; then
  az role assignment create --assignee-object-id "$SP_OBJECT_ID" --assignee-principal-type ServicePrincipal --role "$ROLE_NAME" --scope "$SCOPE"
fi

${approvalNote}echo ""
echo "============================================"
echo "  Remediation binding (paste this below):"
echo ""
echo "  ${params.pair.assetClass}:${subscriptionId}=$APP_ID"
echo ""
echo "  Store the SP secret shown by 'az ad app credential reset'"
echo "  (run only when rotating) in the connection vault."
echo ""
echo "============================================"
)`;
}
