import {
  GCP_FIX_FORWARD_ALLOWLIST,
  type GcpRemediationAssetClass,
} from '@gideon-defender/integration-platform';

/**
 * Allowlist context for the GCP fix-plan model.
 *
 * Lives outside `gcp-ai-remediation.prompt.ts` because that file is at the
 * 300-line repo limit. Generated from `GCP_FIX_FORWARD_ALLOWLIST` so the
 * prompt and the executor enforcement cannot drift apart silently — the
 * coverage spec fails when they do.
 */

/**
 * API hosts the prompt documents with fix semantics that are deliberately
 * NOT executable: plans touching them must set `canAutoFix: false` with
 * guided steps. Each entry names the reason so the model repeats it.
 */
export const GCP_GUIDED_ONLY_API_HOSTS: ReadonlyMap<string, string> = new Map([
  [
    'container.googleapis.com',
    'GKE cluster updates can require recreation or cause control-plane downtime — human approval required.',
  ],
  [
    'logging.googleapis.com',
    'Log sink/metric writes change auditability posture — human approval required.',
  ],
]);

/** Hosts covered by the class allowlists (derived, not duplicated). */
export function gcpAllowlistedApiHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const calls of Object.values(GCP_FIX_FORWARD_ALLOWLIST)) {
    for (const call of calls) {
      try {
        hosts.add(new URL(call.urlPrefix).hostname.toLowerCase());
      } catch {
        // Prefixes are static and valid; ignore the impossible.
      }
    }
  }
  return hosts;
}

/**
 * Append the allowlist section to a base prompt. No-op when no asset class
 * is provided, so unscoped callers behave exactly as before.
 */
export function withGcpAllowlistSection(
  basePrompt: string,
  assetClass: GcpRemediationAssetClass | undefined,
): string {
  if (!assetClass) return basePrompt;
  return `${basePrompt}\n\n${buildAllowlistPromptSection(assetClass)}`;
}

/**
 * Prompt section constraining the model to its asset class's allowlist.
 */
export function buildAllowlistPromptSection(
  assetClass: GcpRemediationAssetClass,
): string {
  const calls = GCP_FIX_FORWARD_ALLOWLIST[assetClass];
  const lines = calls.map((c) => `- ${c.method} ${c.urlPrefix}…`);
  const guided = [...GCP_GUIDED_ONLY_API_HOSTS.entries()]
    .map(([host, reason]) => `- ${host}: ${reason}`)
    .join('\n');
  const gated =
    assetClass === 'Network' || assetClass === 'Security-Global'
      ? '\nYour asset class is approval-gated: set canAutoFix=false and provide guidedSteps with gcloud commands instead of fix steps.'
      : '';
  return `## EXECUTION ALLOWLIST (asset class: ${assetClass}) — NEVER violate
Your fix steps MUST stay within this list. Anything else → set canAutoFix=false with guidedSteps.
${lines.join('\n')}

APIs that are ALWAYS guided-only (never emit fix steps for these hosts):
${guided}${gated}`;
}
