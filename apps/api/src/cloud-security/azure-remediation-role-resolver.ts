import {
  azureFindingToAssetClass,
  azureRemediationKey,
  isApprovalGatedAzureAssetClass,
  parseAzureRemediationMap,
  parseAzureRemediationSecrets,
  type AzureRemediationAssetClass,
} from '@gideon-defender/integration-platform';

/**
 * Resolve the remediator SP for one finding: pair map first
 * (`Class:subscription`). Both `undefined` when the connection has no
 * binding for this pair — callers fail closed (guided-only preview /
 * throw) instead of falling back to the user OAuth token.
 *
 * Routing is not authorization: callers must additionally refuse
 * auto-execute for approval-gated classes (Network, Security-Global) — a
 * configured binding there enables reads, never writes.
 */
export function resolveAzureRemediationIdentity(args: {
  credentials: Record<string, unknown>;
  resourceType: string | null;
  subscriptionId: string;
}): {
  spAppId: string | undefined;
  assetClass: AzureRemediationAssetClass;
  approvalGated: boolean;
  expectedKey: string;
} {
  const assetClass = azureFindingToAssetClass(args.resourceType);
  const subscriptionId = args.subscriptionId.trim();
  // Garbage subscription ids must degrade to guided-only, never throw a
  // 500 out of preview. Key minting throws on invalid input, so fall back
  // to a display-only key and leave the SP unresolved.
  let expectedKey: string;
  try {
    expectedKey = azureRemediationKey({ assetClass, subscriptionId });
  } catch {
    expectedKey = `${assetClass}:${subscriptionId || 'unknown-subscription'}`;
    return {
      spAppId: undefined,
      assetClass,
      approvalGated: isApprovalGatedAzureAssetClass(assetClass),
      expectedKey,
    };
  }
  const rawMap =
    typeof args.credentials.azureRemediation === 'string'
      ? args.credentials.azureRemediation
      : undefined;
  const pairMap = parseAzureRemediationMap(rawMap);
  const spAppId = pairMap[expectedKey];
  return {
    spAppId,
    assetClass,
    approvalGated: isApprovalGatedAzureAssetClass(assetClass),
    expectedKey,
  };
}

export interface AzureExecutionIdentity {
  spAppId: string;
  secret: string;
  assetClass: AzureRemediationAssetClass;
  subscriptionId: string;
  expectedKey: string;
}

/**
 * Resolve the SP that must execute a fix, throwing instead of degrading.
 * Unbound pairs, approval-gated classes, and pairs without a stored
 * secret all throw with guided-only / human-approval messages — callers
 * surface these instead of falling back to the user OAuth token, which
 * would execute with unbounded RBAC.
 */
export function resolveAzureExecutionIdentity(args: {
  credentials: Record<string, unknown>;
  resourceType: string | null;
  subscriptionId: string;
}): AzureExecutionIdentity {
  const routed = resolveAzureRemediationIdentity(args);
  if (!routed.spAppId) {
    throw new Error(
      `No remediator SP bound for ${routed.expectedKey} — bind the pair from the setup script. Guided-only for now.`,
    );
  }
  if (routed.approvalGated) {
    throw new Error(
      `${routed.assetClass} findings require human approval — a configured binding enables reads, never writes.`,
    );
  }
  const secrets = parseAzureRemediationSecrets(
    typeof args.credentials.azureRemediationSecrets === 'string'
      ? args.credentials.azureRemediationSecrets
      : undefined,
  );
  const secret = secrets[routed.expectedKey];
  if (!secret) {
    throw new Error(
      `Remediator SP binding ${routed.expectedKey} has no stored client secret — re-run the setup script and paste back the map and secrets together.`,
    );
  }
  const subscriptionId = routed.expectedKey.slice(
    routed.expectedKey.indexOf(':') + 1,
  );
  return {
    spAppId: routed.spAppId,
    secret,
    assetClass: routed.assetClass,
    subscriptionId,
    expectedKey: routed.expectedKey,
  };
}
