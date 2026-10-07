import {
  AZURE_REMEDIATOR_SP_APP_ID_PATTERN,
  SAFE_AZURE_SUBSCRIPTION_PATTERN,
} from './remediation-roles';

/**
 * Customer-side detection signals for the per-class remediator service
 * principals (`opencomp-remediator-<class>`, Azure Phase C).
 *
 * Mirrors `../gcp/remediation-detection-filters` for GCP and
 * `../aws/remediation-detection` for AWS. OpenComp cannot deploy into the
 * customer's subscription, so this module ships the detection content the
 * customer deploys instead:
 *
 * - three Activity Log signals (one per rule, each backing an
 *   `az monitor activity-log alert` rule),
 * - three forensic queries (KQL for Log Analytics + `az monitor
 *   activity-log list` one-liners).
 *
 * Wiring (action group, alert rules) lives in
 * `./remediation-detection-script`, which builds the Cloud Shell setup
 * script from these conditions so alerts and queries cannot drift apart.
 *
 * The three signals mirror the rollout plan: every control-plane write by
 * a remediator SP (the Azure equivalent of an `AssumeRole` / token mint —
 * fixes authenticate as the class SP directly, so a write IS the use),
 * every failed call from a remediator SP session (the observable proxy
 * for an allowlist/guardrail-blocked write that reached the API anyway),
 * and any remediator-SP write to an approval-gated surface (role
 * assignments, role definitions, vaults — classes the executor refuses
 * even when bound, so any such write needs a human review note).
 *
 * Two Azure-specific notes baked into the conditions below. First, the
 * actor match is the SP application (client) ID: Activity Log records the
 * client ID in `caller` for service-principal authentication, which is
 * exactly what the binding map stores. Second, reads run with the
 * end-user auditor OAuth token, never the remediator SP — so matching
 * the remediator SP as caller cannot fire on routine reads. Key Vault
 * data-plane reads/writes are blind here (they need diagnostic settings,
 * not Activity Log) — the vault control-plane surface below is the
 * closest Activity Log signal.
 */

export const AZURE_REMEDIATION_DETECTION_RULES = [
  'OpenComp-RemediatorWrite',
  'OpenComp-RemediatorDenied',
  'OpenComp-RemediatorApprovalGated',
] as const;

export type AzureRemediationDetectionRule = (typeof AZURE_REMEDIATION_DETECTION_RULES)[number];

export const AZURE_REMEDIATION_DETECTION_DESCRIPTIONS: Record<
  AzureRemediationDetectionRule,
  string
> = {
  'OpenComp-RemediatorWrite': 'OpenComp: remediator service principal wrote',
  'OpenComp-RemediatorDenied': 'OpenComp: failed call from a remediator session',
  'OpenComp-RemediatorApprovalGated':
    'OpenComp: remediator touched an approval-gated surface (review required)',
};

/**
 * Approval-gated control-plane surfaces: a remediator SP must never
 * write these (the allowlist carries no vault entries and the never-allow
 * scan refuses role grants pre-execution). `code` is the short rule-name
 * fragment — full resource-type paths would push alert names past limits.
 */
export const AZURE_APPROVAL_GATED_SURFACES = [
  {
    resourceType: 'Microsoft.Authorization/roleAssignments',
    code: 'RoleAssign',
  },
  {
    resourceType: 'Microsoft.Authorization/roleDefinitions',
    code: 'RoleDef',
  },
  { resourceType: 'Microsoft.KeyVault/vaults', code: 'KeyVault' },
] as const;

export type AzureApprovalGatedSurfaceCode = (typeof AZURE_APPROVAL_GATED_SURFACES)[number]['code'];

/** One Activity Log alert condition (`field=value`, ANDed by the CLI). */
export interface AzureAlertCondition {
  field: string;
  equals: string;
}

/**
 * Reject anything that is not an SP application (client) ID. The value
 * lands inside a single-quoted shell string in the generated script — a
 * GUID cannot break quoting, so validation here keeps every rule intact.
 */
function assertSpAppId(value: string): string {
  const appId = value.trim();
  if (!AZURE_REMEDIATOR_SP_APP_ID_PATTERN.test(appId)) {
    throw new Error(
      `Azure remediation detection requires an SP application (client) ID, got "${value}"`,
    );
  }
  return appId;
}

/**
 * Reject anything that is not an Azure subscription ID. The value lands
 * inside a double-quoted shell string in the forensic CLI one-liners — a
 * GUID cannot break quoting, so validation here keeps every command intact.
 */
function assertSubscriptionId(value: string): string {
  const subscription = value.trim();
  if (!SAFE_AZURE_SUBSCRIPTION_PATTERN.test(subscription)) {
    throw new Error(
      `buildAzureForensicQueries requires a valid Azure subscription id, got "${value}"`,
    );
  }
  return subscription;
}

function assertSurfaceCode(code: string): string {
  const surface = AZURE_APPROVAL_GATED_SURFACES.find((entry) => entry.code === code);
  if (!surface) {
    throw new Error(
      `unknown Azure approval-gated surface: "${code}" (expected one of ${AZURE_APPROVAL_GATED_SURFACES.map((entry) => entry.code).join(', ')})`,
    );
  }
  return surface.resourceType;
}

/**
 * Control-plane writes by one remediator SP. Succeeded only — failed
 * calls page through the Denied signal instead, so one event fires one
 * alert, never two. Every fix writes exactly one plan, so reconcile each
 * alert with a fix you triggered.
 */
export function buildAzureRemediatorWriteConditions(spAppId: string): AzureAlertCondition[] {
  const caller = assertSpAppId(spAppId);
  return [
    { field: 'caller', equals: caller },
    { field: 'category', equals: 'Administrative' },
    { field: 'status', equals: 'Succeeded' },
  ];
}

/**
 * Failed calls made as one remediator SP. This is the observable proxy
 * for a blocked write: the log does not record which allowlist or
 * guardrail refused the plan, but the SP caller identifies the actor.
 * No `category` filter: a failed call arrives under any category, so
 * scoping to one would miss hits. Triage in the runbook separates 403s
 * (guardrail-blocked drift) from other failures (breakage).
 */
export function buildAzureRemediatorDeniedConditions(spAppId: string): AzureAlertCondition[] {
  const caller = assertSpAppId(spAppId);
  return [
    { field: 'caller', equals: caller },
    { field: 'status', equals: 'Failed' },
  ];
}

/**
 * Writes by one remediator SP to one approval-gated surface. Any status:
 * a failed escalation attempt is as much signal as a succeeded one.
 * `Network` and `Security-Global` findings never auto-execute — the API
 * refuses them even when bound — so a write here is either a human acting
 * through the SP (needs a review note) or a bypass (treat as an incident).
 */
export function buildAzureApprovalGatedConditions(params: {
  spAppId: string;
  surfaceCode: string;
}): AzureAlertCondition[] {
  const caller = assertSpAppId(params.spAppId);
  const resourceType = assertSurfaceCode(params.surfaceCode);
  return [
    { field: 'caller', equals: caller },
    { field: 'category', equals: 'Administrative' },
    { field: 'resourceType', equals: resourceType },
  ];
}

export function buildAzureDetectionConditions(params: {
  rule: AzureRemediationDetectionRule;
  spAppId: string;
  surfaceCode?: string;
}): AzureAlertCondition[] {
  switch (params.rule) {
    case 'OpenComp-RemediatorWrite':
      return buildAzureRemediatorWriteConditions(params.spAppId);
    case 'OpenComp-RemediatorDenied':
      return buildAzureRemediatorDeniedConditions(params.spAppId);
    case 'OpenComp-RemediatorApprovalGated': {
      if (!params.surfaceCode) {
        throw new Error(
          'OpenComp-RemediatorApprovalGated requires a surfaceCode (one of RoleAssign, RoleDef, KeyVault)',
        );
      }
      return buildAzureApprovalGatedConditions({
        spAppId: params.spAppId,
        surfaceCode: params.surfaceCode,
      });
    }
    default:
      throw new Error(`unknown Azure remediation detection rule: "${params.rule}"`);
  }
}

/** Render conditions to `az monitor activity-log alert create` syntax. */
export function renderAzureAlertCondition(conditions: AzureAlertCondition[]): string {
  return conditions.map((entry) => `${entry.field}=${entry.equals}`).join(' and ');
}

export interface AzureForensicQuery {
  name: string;
  description: string;
  /** KQL against the AzureActivity table (route Activity Log to Log Analytics first). `<SP_APP_IDS>` expands at build time. */
  kql: string;
  /** Copy-paste `az monitor activity-log list` equivalent (add `--caller <app-id>` to scope to one SP). */
  azCli: string;
}

/**
 * Forensic queries for all three signals over one set of remediator SPs.
 * KQL embeds the quoted app IDs; the CLI equivalents stay caller-wide
 * (`az monitor activity-log list` takes one `--caller`, so the runbook
 * scopes per SP at triage time).
 */
export function buildAzureForensicQueries(params: {
  spAppIds: string[];
  subscriptionId: string;
}): AzureForensicQuery[] {
  if (params.spAppIds.length === 0) {
    throw new Error('buildAzureForensicQueries requires at least one SP application ID');
  }
  const callers = params.spAppIds.map((appId) => assertSpAppId(appId));
  const quoted = callers.map((caller) => `"${caller}"`).join(', ');
  const subscription = assertSubscriptionId(params.subscriptionId);
  return [
    {
      name: 'azure-remediator-writes-7d',
      description:
        'Every control-plane write by a remediator SP in the last 7 days. Reconcile each row with a fix you triggered.',
      kql: `AzureActivity
| where TimeGenerated > ago(7d)
| where Caller in (${quoted})
| where CategoryValue == "Administrative"
| project TimeGenerated, Caller, OperationNameValue, ActivityStatusValue, ResourceId, CorrelationId
| order by TimeGenerated desc
| take 100`,
      azCli: `az monitor activity-log list --subscription "${subscription}" --max-events 100 --select eventTimestamp caller operationName status resourceId correlationId`,
    },
    {
      name: 'azure-remediator-denied-7d',
      description:
        'Failed calls from remediator sessions — the forensic view of allowlist/guardrail-blocked writes that reached the API.',
      kql: `AzureActivity
| where TimeGenerated > ago(7d)
| where Caller in (${quoted})
| where ActivityStatusValue == "Failed"
| project TimeGenerated, Caller, OperationNameValue, ResourceId, Properties
| order by TimeGenerated desc
| take 100`,
      azCli: `az monitor activity-log list --subscription "${subscription}" --status Failed --max-events 100 --select eventTimestamp caller operationName status resourceId correlationId`,
    },
    {
      name: 'azure-remediator-approval-gated-30d',
      description:
        'Every remediator-SP write to an approval-gated surface in the last 30 days. Each row needs a human review note.',
      kql: `AzureActivity
| where TimeGenerated > ago(30d)
| where Caller in (${quoted})
| where ResourceProviderValue in ("Microsoft.Authorization", "Microsoft.KeyVault")
| project TimeGenerated, Caller, OperationNameValue, ActivityStatusValue, ResourceId, CorrelationId
| order by TimeGenerated desc
| take 100`,
      // One --resource-provider per invocation (the flag takes a single
      // value), so the CLI equivalent is two commands — one per provider the
      // KQL covers — or vault writes would silently go missing.
      azCli: `az monitor activity-log list --subscription "${subscription}" --resource-provider Microsoft.Authorization --max-events 100 --select eventTimestamp caller operationName status resourceId correlationId; az monitor activity-log list --subscription "${subscription}" --resource-provider Microsoft.KeyVault --max-events 100 --select eventTimestamp caller operationName status resourceId correlationId`,
    },
  ];
}
