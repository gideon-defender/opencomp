/**
 * `gcloud` setup scripts for per-class remediator bindings (GCP Phase 1).
 *
 * Mirrors `../aws/remediation-script` for AWS: generates the customer-side
 * commands that create the remediator service account, bind the per-class
 * custom roles, and grant `tokenCreator` to the backend impersonator
 * identity. Safe to re-run: existing SA/roles are reused and bindings are
 * converged in place. No keys are ever created for the remediator SA.
 */
import { escapeDoubleQuotedShell } from '../aws/remediation-roles';
import {
  GCP_REMEDIATOR_SA_NAME,
  SAFE_GCP_PROJECT_PATTERN,
  gcpRemediationRoleId,
  type GcpRemediationAssetClass,
} from './remediation-roles';

export interface GcpRemediationScriptPair {
  assetClass: GcpRemediationAssetClass;
  projectId: string;
}

/**
 * `gcloud` setup script for ONE class x project remediator binding.
 * Prints the `Class:project -> SA email` map entry at the end for
 * paste-back into the connection settings.
 */
export function getGcpRemediationScriptForPair(params: {
  pair: GcpRemediationScriptPair;
  impersonatorServiceAccount: string;
}): string {
  const projectId = params.pair.projectId.trim();
  if (!SAFE_GCP_PROJECT_PATTERN.test(projectId)) {
    throw new Error(
      `getGcpRemediationScriptForPair requires a valid GCP project id, got "${params.pair.projectId}"`,
    );
  }
  const saEmail = `${GCP_REMEDIATOR_SA_NAME}@${projectId}.iam.gserviceaccount.com`;
  const roleId = gcpRemediationRoleId({ assetClass: params.pair.assetClass });
  // Defense in depth: the project id is pattern-validated above, but every
  // interpolated value is still escaped — the generated script runs with the
  // customer's owner privileges in Cloud Shell.
  const safeProject = escapeDoubleQuotedShell(projectId);
  const safeSaEmail = escapeDoubleQuotedShell(saEmail);
  const safeRoleId = escapeDoubleQuotedShell(roleId);
  const safeImpersonator = escapeDoubleQuotedShell(params.impersonatorServiceAccount.trim());
  const approvalNote =
    params.pair.assetClass === 'Network' || params.pair.assetClass === 'Security-Global'
      ? '# NOTE: this class is approval-gated — fixes stay guided-only until a human approves.\n'
      : '';

  return `# Remediator binding ${params.pair.assetClass}:${projectId} (fix-forward only)
# Run in Cloud Shell with an owner on ${projectId}. Safe to re-run.
# No keys are created for the remediator SA — fixes use short-lived impersonated tokens.
(
set -euo pipefail

PROJECT="${safeProject}"
SA_EMAIL="${safeSaEmail}"
ROLE_ID="${safeRoleId}"

gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" >/dev/null 2>&1 \\
  || gcloud iam service-accounts create ${GCP_REMEDIATOR_SA_NAME} \\
    --project="$PROJECT" --display-name="OpenComp Remediator"

gcloud projects add-iam-policy-binding "$PROJECT" \\
  --member="serviceAccount:$SA_EMAIL" \\
  --role="projects/$PROJECT/roles/$ROLE_ID"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \\
  --project="$PROJECT" \\
  --member="serviceAccount:${safeImpersonator}" \\
  --role="roles/iam.serviceAccountTokenCreator"

${approvalNote}echo ""
echo "============================================"
echo "  Remediation binding (paste this below):"
echo ""
echo "  ${params.pair.assetClass}:${projectId}=${saEmail}"
echo ""
echo "============================================"
)`;
}
