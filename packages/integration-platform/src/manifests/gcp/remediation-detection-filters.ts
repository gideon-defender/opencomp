import { GCP_REMEDIATOR_SA_NAME } from './remediation-roles';

/**
 * Customer-side detection signals for the per-class remediator service
 * accounts (`opencomp-remediator@<project>.iam.gserviceaccount.com`).
 *
 * Mirrors `../aws/remediation-detection` for AWS. OpenComp cannot deploy
 * into the customer's project, so this module ships the detection content
 * the customer deploys instead:
 *
 * - three Cloud Logging filters (one per signal, each backing a log-based
 *   metric + alerting policy),
 * - three saved Logging queries (threat-hunt / forensics).
 *
 * Wiring (metrics, alerting policies, email channel, audit-log enablement)
 * lives in `./remediation-detection-script`, which builds the Cloud Shell
 * setup script from these filters so alerts and queries cannot drift apart.
 *
 * The three signals mirror the rollout plan: every impersonation of a
 * remediator SA (the GCP equivalent of an `AssumeRole` — fixes mint a
 * short-lived token per execution via `generateAccessToken`), every
 * IAM-denied call from a remediator SA session (the observable proxy for
 * an allowlist/guardrail-blocked write that reached the API anyway), and
 * any remediator-SA write to an approval-gated surface (IAM, KMS,
 * org policy, DNS, firewalls/routes — classes the executor refuses even
 * when bound, so any such write needs a human review note).
 *
 * Two GCP-specific notes baked into the filters below. First, the
 * impersonation signal matches on the *target* (`resourceName`), not the
 * caller: the principal minting the token is the backend impersonator SA,
 * whose email is customer-specific and unknown to this module. Second,
 * reads (including `:getIamPolicy` prior-state reads) run with the
 * end-user auditor OAuth token, never the remediator SA — so matching the
 * remediator SA as principal cannot fire on routine reads.
 */

export const GCP_REMEDIATION_DETECTION_RULES = [
  'OpenComp-RemediatorImpersonate',
  'OpenComp-RemediatorDenied',
  'OpenComp-RemediatorApprovalGated',
] as const;

export type GcpRemediationDetectionRule = (typeof GCP_REMEDIATION_DETECTION_RULES)[number];

/** Log-based metric id per signal (project-scoped, created by the script). */
export const GCP_REMEDIATION_DETECTION_METRICS: Record<GcpRemediationDetectionRule, string> = {
  'OpenComp-RemediatorImpersonate': 'opencomp-remediator-impersonate',
  'OpenComp-RemediatorDenied': 'opencomp-remediator-denied',
  'OpenComp-RemediatorApprovalGated': 'opencomp-remediator-approval-gated',
};

export const GCP_REMEDIATION_DETECTION_DESCRIPTIONS: Record<GcpRemediationDetectionRule, string> = {
  'OpenComp-RemediatorImpersonate': 'OpenComp: remediator service account impersonated',
  'OpenComp-RemediatorDenied': 'OpenComp: denied call from a remediator session',
  'OpenComp-RemediatorApprovalGated':
    'OpenComp: remediator touched an approval-gated surface (review required)',
};

/** Email fragment every remediator SA address carries (`<name>@<project>.iam.gserviceaccount.com`). */
const REMEDIATOR_SA_FRAGMENT = `${GCP_REMEDIATOR_SA_NAME}@`;

/**
 * Token mints for any remediator SA. Fires on success AND on failed
 * impersonations (wrong-caller probes included — those are signal, not
 * noise). Every fix mints exactly one token, so reconcile each alert with
 * a fix you triggered.
 *
 * Requires Data Access `ADMIN_READ` audit logs for the IAM API
 * (`iamcredentials` logs cannot be enabled on their own). The generated
 * setup script turns this on; hand-rolled setups must enable it first or
 * this metric stays empty on default projects.
 */
export function buildGcpImpersonationFilter(): string {
  return [
    'protoPayload.serviceName="iamcredentials.googleapis.com"',
    'protoPayload.methodName="GenerateAccessToken"',
    `protoPayload.resourceName:"${REMEDIATOR_SA_FRAGMENT}"`,
  ].join('\n');
}

/**
 * IAM-denied calls made with a remediator SA token. This is the observable
 * proxy for a blocked write: the audit log does not record which
 * allowlist/guardrail refused the plan, but the SA principal identifies
 * the actor. Admin Activity audit logs (always on) capture denied *writes*;
 * denied *reads* only appear when Data Access `DATA_READ` logs are enabled.
 */
export function buildGcpDeniedFilter(): string {
  // No `serviceName` filter: a denied call arrives under the *called*
  // service (storage, compute, …), so scoping to one service would miss
  // most hits. The status code + SA principal pair is the selective part.
  // Numeric `7` is PERMISSION_DENIED — quoted `"7"` would compare as a
  // string and never match the numeric enum field.
  return [
    `protoPayload.authenticationInfo.principalEmail:"${REMEDIATOR_SA_FRAGMENT}"`,
    'protoPayload.status.code=7',
  ].join('\n');
}

/**
 * Any remediator-SA write to an approval-gated surface. `Network` and
 * `Security-Global` findings never auto-execute — the API refuses them even
 * when a remediator SA is bound — so a write here is either a human acting
 * through the SA (needs a review note) or a bypass (treat as an incident).
 * Routine auto-fix surfaces (Storage, SQL, Pub/Sub, BigQuery, Compute
 * instances) are deliberately absent: those must not page.
 */
export function buildGcpApprovalGatedFilter(): string {
  return [
    `protoPayload.authenticationInfo.principalEmail:"${REMEDIATOR_SA_FRAGMENT}"`,
    '(',
    'protoPayload.serviceName="iam.googleapis.com"',
    'OR protoPayload.serviceName="cloudkms.googleapis.com"',
    'OR protoPayload.serviceName="orgpolicy.googleapis.com"',
    'OR protoPayload.serviceName="dns.googleapis.com"',
    'OR protoPayload.methodName:"firewalls"',
    'OR protoPayload.methodName:"routes"',
    'OR protoPayload.methodName:"IamPolicy"',
    ')',
  ].join('\n');
}

export function buildGcpDetectionFilter(params: { rule: GcpRemediationDetectionRule }): string {
  switch (params.rule) {
    case 'OpenComp-RemediatorImpersonate':
      return buildGcpImpersonationFilter();
    case 'OpenComp-RemediatorDenied':
      return buildGcpDeniedFilter();
    case 'OpenComp-RemediatorApprovalGated':
      return buildGcpApprovalGatedFilter();
    default:
      throw new Error(`unknown GCP remediation detection rule: "${params.rule}"`);
  }
}

export interface GcpRemediationLogQuery {
  name: string;
  description: string;
  /** Logging filter to paste into Logs Explorer (set the time range in the picker — filters take no relative window). */
  filter: string;
}

export const GCP_REMEDIATION_LOG_QUERIES: GcpRemediationLogQuery[] = [
  {
    name: 'gcp-remediator-impersonations',
    description:
      'Every generateAccessToken for a remediator SA, including failed impersonations (wrong-caller probes). Set the time range to the window under review.',
    filter: buildGcpImpersonationFilter(),
  },
  {
    name: 'gcp-remediator-denied',
    description:
      'Denied API calls from remediator sessions — the forensic view of allowlist/guardrail-blocked writes that reached the API.',
    filter: buildGcpDeniedFilter(),
  },
  {
    name: 'gcp-remediator-approval-gated',
    description:
      'Every remediator-SA write to an approval-gated surface. Each row needs a human review note.',
    filter: buildGcpApprovalGatedFilter(),
  },
];
