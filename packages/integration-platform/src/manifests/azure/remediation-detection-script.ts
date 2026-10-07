import { escapeDoubleQuotedShell } from '../aws/remediation-roles';
import {
  AZURE_APPROVAL_GATED_SURFACES,
  AZURE_REMEDIATION_DETECTION_DESCRIPTIONS,
  buildAzureDetectionConditions,
  renderAzureAlertCondition,
  type AzureApprovalGatedSurfaceCode,
  type AzureRemediationDetectionRule,
} from './remediation-detection-filters';
import {
  AZURE_REMEDIATION_ASSET_CLASSES,
  AZURE_REMEDIATOR_SP_APP_ID_PATTERN,
  SAFE_AZURE_SUBSCRIPTION_PATTERN,
  type AzureRemediationAssetClass,
} from './remediation-roles';

/**
 * Wiring for the customer-side Azure remediator detection signals defined
 * in `./remediation-detection-filters`: one action group plus the Cloud
 * Shell setup script that creates it and one Activity Log alert rule per
 * signal. Conditions are imported, never copied, so alerts and forensic
 * queries cannot drift apart.
 */

export interface AzureRemediationDetectionService {
  assetClass: AzureRemediationAssetClass;
  /** Remediator SP application (client) ID for the class (the binding-map value). */
  appId: string;
}

export interface AzureRemediationDetectionScriptOptions {
  /** Subscription holding the remediator SPs (alerts scope to it). */
  subscriptionId: string;
  /** Resource group hosting the action group and alert rules. */
  resourceGroup: string;
  /** Bound class SPs — one entry per `Class:subscription` map row. */
  services: AzureRemediationDetectionService[];
  /** Email that receives the alerts (confirmation required). */
  email: string;
  /** Action-group name. Defaults to `OpenComp-Remediator-Alerts`. */
  actionGroupName?: string;
}

export const AZURE_REMEDIATION_DETECTION_ACTION_GROUP_NAME = 'OpenComp-Remediator-Alerts';

/** Action-group short names allow ≤12 alphanumeric characters. */
const AZURE_DETECTION_SHORT_NAME = 'OpenComp';

/** Azure resource groups allow alphanumerics, periods, underscores, hyphens, parentheses (≤90 chars). */
const SAFE_AZURE_RESOURCE_GROUP_PATTERN = /^[A-Za-z0-9._()-]{1,90}$/;

/** Action-group names land in double-quoted shell strings — same charset discipline as the SNS topic guard. */
const SAFE_ACTION_GROUP_NAME_PATTERN = /^[A-Za-z0-9_-]{1,260}$/;

/** Alert-rule display name per signal and class (all under 60 chars by construction). */
export function azureDetectionRuleName(params: {
  rule: AzureRemediationDetectionRule;
  assetClass: AzureRemediationAssetClass;
  surfaceCode?: AzureApprovalGatedSurfaceCode;
}): string {
  if (params.rule === 'OpenComp-RemediatorApprovalGated') {
    if (!params.surfaceCode) {
      throw new Error('approval-gated alert rules require a surfaceCode');
    }
    return `${params.rule}-${params.assetClass}-${params.surfaceCode}`;
  }
  return `${params.rule}-${params.assetClass}`;
}

/** Fully qualified action-group resource ID for `--action-group`. */
export function azureActionGroupId(params: {
  subscriptionId: string;
  resourceGroup: string;
  actionGroupName: string;
}): string {
  return `/subscriptions/${params.subscriptionId}/resourceGroups/${params.resourceGroup}/providers/microsoft.insights/actionGroups/${params.actionGroupName}`;
}

function assertValidOptions(options: AzureRemediationDetectionScriptOptions): {
  subscriptionId: string;
  resourceGroup: string;
  actionGroupName: string;
} {
  const subscriptionId = options.subscriptionId.trim();
  if (!SAFE_AZURE_SUBSCRIPTION_PATTERN.test(subscriptionId)) {
    throw new Error(
      `getAzureRemediationDetectionScript requires a valid Azure subscription id, got "${options.subscriptionId}"`,
    );
  }
  const resourceGroup = options.resourceGroup.trim();
  if (!SAFE_AZURE_RESOURCE_GROUP_PATTERN.test(resourceGroup)) {
    throw new Error(
      `getAzureRemediationDetectionScript requires a valid resource group name, got "${options.resourceGroup}"`,
    );
  }
  const actionGroupName = (
    options.actionGroupName ?? AZURE_REMEDIATION_DETECTION_ACTION_GROUP_NAME
  ).trim();
  if (!SAFE_ACTION_GROUP_NAME_PATTERN.test(actionGroupName)) {
    throw new Error(
      `invalid action group name: "${options.actionGroupName}" (letters, numbers, hyphens, underscores only)`,
    );
  }
  if (options.services.length === 0) {
    throw new Error(
      'getAzureRemediationDetectionScript requires at least one bound class SP (one entry per Class:subscription map row)',
    );
  }
  const seen = new Set<string>();
  for (const service of options.services) {
    if (!(AZURE_REMEDIATION_ASSET_CLASSES as readonly string[]).includes(service.assetClass)) {
      throw new Error(
        `unknown Azure asset class: "${service.assetClass}" (expected one of ${AZURE_REMEDIATION_ASSET_CLASSES.join(', ')})`,
      );
    }
    if (!AZURE_REMEDIATOR_SP_APP_ID_PATTERN.test(service.appId.trim())) {
      throw new Error(
        `Azure remediation detection requires an SP application (client) ID for ${service.assetClass}, got "${service.appId}"`,
      );
    }
    if (seen.has(service.assetClass)) {
      throw new Error(
        `duplicate Azure asset class in detection services: "${service.assetClass}" (one SP per class per subscription)`,
      );
    }
    seen.add(service.assetClass);
  }
  return { subscriptionId, resourceGroup, actionGroupName };
}

/**
 * Cloud Shell setup script: creates the email action group and one
 * Activity Log alert rule per signal (per SP, per gated surface). Safe to
 * rerun: the action group upserts in place and each alert rule is
 * deleted before creation, so a rerun converges instead of aborting
 * under `set -euo pipefail`. Run once per subscription that holds
 * remediator SPs.
 */
export function getAzureRemediationDetectionScript(
  options: AzureRemediationDetectionScriptOptions,
): string {
  const { subscriptionId, resourceGroup, actionGroupName } = assertValidOptions(options);
  const safeEmail = escapeDoubleQuotedShell(options.email);

  const alertBlock = (params: {
    rule: AzureRemediationDetectionRule;
    assetClass: AzureRemediationAssetClass;
    appId: string;
    surfaceCode?: AzureApprovalGatedSurfaceCode;
  }): string[] => {
    const name = azureDetectionRuleName({
      rule: params.rule,
      assetClass: params.assetClass,
      ...(params.surfaceCode ? { surfaceCode: params.surfaceCode } : {}),
    });
    const condition = renderAzureAlertCondition(
      buildAzureDetectionConditions({
        rule: params.rule,
        spAppId: params.appId,
        ...(params.surfaceCode ? { surfaceCode: params.surfaceCode } : {}),
      }),
    );
    const description = AZURE_REMEDIATION_DETECTION_DESCRIPTIONS[params.rule];
    return [
      `# ${name} — ${description}.`,
      `az monitor activity-log alert delete --name "${name}" --resource-group "$RESOURCE_GROUP" 2>/dev/null || true`,
      `az monitor activity-log alert create --name "${name}" --resource-group "$RESOURCE_GROUP" --scopes "/subscriptions/${subscriptionId}" --condition '${condition}' --action-group "$ACTION_GROUP_ID" --description "${description}"`,
    ];
  };

  const serviceBlocks = options.services.flatMap((service) => {
    const blocks: string[] = [];
    blocks.push(
      '',
      ...alertBlock({
        rule: 'OpenComp-RemediatorWrite',
        assetClass: service.assetClass,
        appId: service.appId,
      }),
      '',
      ...alertBlock({
        rule: 'OpenComp-RemediatorDenied',
        assetClass: service.assetClass,
        appId: service.appId,
      }),
    );
    for (const surface of AZURE_APPROVAL_GATED_SURFACES) {
      blocks.push(
        '',
        ...alertBlock({
          rule: 'OpenComp-RemediatorApprovalGated',
          assetClass: service.assetClass,
          appId: service.appId,
          surfaceCode: surface.code,
        }),
      );
    }
    return blocks;
  });

  return [
    'set -euo pipefail',
    '',
    '# 1. Scope under watch (holds the remediator SPs).',
    `SUBSCRIPTION="${subscriptionId}"`,
    `RESOURCE_GROUP="${resourceGroup}"`,
    '',
    '# 2. Email action group for the alerts (upserts in place on rerun).',
    `ACTION_GROUP_ID="$(az monitor action-group create --name "${actionGroupName}" --resource-group "$RESOURCE_GROUP" --short-name "${AZURE_DETECTION_SHORT_NAME}" --email-receiver name=NotifySecurity email_address="${safeEmail}" --query id --output tsv)"`,
    'echo "Confirm the action-group verification email before expecting alerts."',
    '',
    '# 3. One Activity Log alert rule per signal (delete-then-create so reruns converge).',
    ...serviceBlocks,
    '',
    'echo "Detection wired. Current rules:"',
    `az monitor activity-log alert list --resource-group "$RESOURCE_GROUP" --query "[?starts_with(name, 'OpenComp-Remediator')].name" --output table`,
  ].join('\n');
}
