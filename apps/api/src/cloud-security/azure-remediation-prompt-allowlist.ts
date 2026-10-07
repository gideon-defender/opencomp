import {
  AZURE_FIX_FORWARD_ALLOWLIST,
  AZURE_NEVER_ALLOW_ACTIONS,
  isApprovalGatedAzureAssetClass,
  type AzureRemediationAssetClass,
} from '@gideon-defender/integration-platform';

/**
 * Control-plane hosts an Azure fix plan may call, derived from the
 * fix-forward URL allowlist (every entry shares the management host).
 * Reads may additionally fan out to Graph; writes never do.
 */
export function azureAllowlistedApiHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const entries of Object.values(AZURE_FIX_FORWARD_ALLOWLIST)) {
    for (const entry of entries) {
      try {
        hosts.add(new URL(entry.urlPrefix).hostname);
      } catch {
        // Allowlist entries are static and valid; skip defensively.
      }
    }
  }
  return hosts;
}

/**
 * Render the `## EXECUTION ALLOWLIST` prompt section for one asset class
 * from the same allowlist object the validator enforces — generated, not
 * hand-written, so prompt and enforcement cannot drift apart silently
 * (the drift test fails the build when they do).
 */
export function buildAzureAllowlistPromptSection(
  assetClass: AzureRemediationAssetClass,
): string {
  const calls = AZURE_FIX_FORWARD_ALLOWLIST[assetClass]
    .map((entry) => `- ${entry.method} ${entry.urlPrefix}`)
    .join('\n');
  const never = AZURE_NEVER_ALLOW_ACTIONS.map((action) => `- ${action}`).join(
    '\n',
  );
  const gated = isApprovalGatedAzureAssetClass(assetClass)
    ? `\n\n${assetClass} is approval-gated: set canAutoFix=false and return guidedSteps only. Never emit fix steps for this class.`
    : '';
  return `## EXECUTION ALLOWLIST (asset class: ${assetClass})
Fix steps may ONLY call these method+URL shapes (subscription and resource-group segments vary; the provider path must match). Anything else goes to guidedSteps with canAutoFix=false — NEVER emit it as a fix step.
${calls}

NEVER emit these grants or calls, even if the finding suggests them:
${never}
- Any Microsoft.Authorization/roleAssignments write (PUT/POST)
- Any Microsoft.Authorization/roleDefinitions write
- Any POST action call (stop/start/register/listKeys)${gated}`;
}

/**
 * Append the execution-allowlist section for the finding's asset class.
 * No-op without a class (ungated preview paths that route before the
 * class is known keep the base prompt).
 */
export function withAzureAllowlistSection(
  basePrompt: string,
  assetClass: AzureRemediationAssetClass | undefined,
): string {
  if (!assetClass) return basePrompt;
  return `${basePrompt}\n\n${buildAzureAllowlistPromptSection(assetClass)}`;
}
