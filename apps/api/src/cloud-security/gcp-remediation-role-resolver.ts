import {
  gcpFindingToAssetClass,
  gcpRemediationKey,
  isApprovalGatedGcpAssetClass,
  parseGcpRemediationMap,
  type GcpRemediationAssetClass,
} from '@gideon-defender/integration-platform';

/**
 * Resolve the remediator SA for one finding: pair map first
 * (`Class:project`). Both `undefined` when the connection has no binding
 * for this pair — callers fail closed (guided-only preview / throw) instead
 * of falling back to the auditor token.
 *
 * Routing is not authorization: callers must additionally refuse
 * auto-execute for approval-gated classes (Network, Security-Global) — a
 * configured binding there enables reads, never writes.
 */
export function resolveGcpRemediationIdentity(args: {
  credentials: Record<string, unknown>;
  resourceType: string | null;
  projectId: string;
}): {
  saEmail: string | undefined;
  assetClass: GcpRemediationAssetClass;
  approvalGated: boolean;
  expectedKey: string;
} {
  const assetClass = gcpFindingToAssetClass(args.resourceType);
  const projectId = args.projectId.trim();
  // Garbage project ids must degrade to guided-only, never throw a 500 out
  // of preview. Key minting throws on invalid input, so fall back to a
  // display-only key and leave the SA unresolved.
  let expectedKey: string;
  try {
    expectedKey = gcpRemediationKey({ assetClass, projectId });
  } catch {
    expectedKey = `${assetClass}:${projectId || 'unknown-project'}`;
    return {
      saEmail: undefined,
      assetClass,
      approvalGated: isApprovalGatedGcpAssetClass(assetClass),
      expectedKey,
    };
  }
  const rawMap =
    typeof args.credentials.gcpRemediation === 'string'
      ? args.credentials.gcpRemediation
      : undefined;
  const pairMap = parseGcpRemediationMap(rawMap);
  const saEmail = pairMap[expectedKey];
  return {
    saEmail,
    assetClass,
    approvalGated: isApprovalGatedGcpAssetClass(assetClass),
    expectedKey,
  };
}
