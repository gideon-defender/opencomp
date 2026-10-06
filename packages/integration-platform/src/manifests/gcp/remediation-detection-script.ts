import { escapeDoubleQuotedShell } from '../aws/remediation-roles';
import {
  buildGcpDetectionFilter,
  GCP_REMEDIATION_DETECTION_DESCRIPTIONS,
  GCP_REMEDIATION_DETECTION_METRICS,
  GCP_REMEDIATION_DETECTION_RULES,
  type GcpRemediationDetectionRule,
} from './remediation-detection-filters';
import { SAFE_GCP_PROJECT_PATTERN } from './remediation-roles';

/**
 * Wiring for the customer-side GCP remediator detection signals defined in
 * `./remediation-detection-filters`: one alerting policy per signal and the
 * Cloud Shell setup script that creates the email channel, the log-based
 * metrics, and the policies. Filters are imported, never copied, so alerts
 * and forensic queries cannot drift apart.
 */

export interface GcpRemediationDetectionScriptOptions {
  /** GCP project holding the remediator SAs (metrics, channel, and policies are created here). */
  projectId: string;
  /** Email that receives the alerts (channel verification required). */
  email: string;
  /** Notification channel display name. Defaults to `OpenComp Remediator Alerts`. */
  channelName?: string;
}

export const GCP_REMEDIATION_DETECTION_CHANNEL_NAME = 'OpenComp Remediator Alerts';

/**
 * Alerting-policy document for one signal. `channelRef` is a *script-time*
 * reference (the channel id captured at run time), defaulting to the
 * `$CHANNEL_ID` variable the generated script sets — callers generating
 * their own script pass the concrete channel name instead.
 */
export function buildGcpAlertingPolicy(params: {
  rule: GcpRemediationDetectionRule;
  channelRef?: string;
}): Record<string, unknown> {
  const metricId = GCP_REMEDIATION_DETECTION_METRICS[params.rule];
  if (!metricId) throw new Error(`unknown GCP remediation detection rule: "${params.rule}"`);
  return {
    displayName: params.rule,
    documentation: {
      content: `${GCP_REMEDIATION_DETECTION_DESCRIPTIONS[params.rule]}. Reconcile with a fix you triggered in OpenComp; no match means investigate.`,
      mimeType: 'text/markdown',
    },
    combiner: 'OR',
    conditions: [
      {
        displayName: GCP_REMEDIATION_DETECTION_DESCRIPTIONS[params.rule],
        conditionThreshold: {
          filter: `metric.type="logging.googleapis.com/user/${metricId}" AND resource.type="global"`,
          comparison: 'COMPARISON_GT',
          thresholdValue: 0,
          duration: '0s',
          trigger: { count: 1 },
          aggregations: [{ alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_COUNT' }],
        },
      },
    ],
    notificationChannels: [params.channelRef ?? '$CHANNEL_ID'],
    enabled: true,
  };
}

/**
 * Cloud Shell setup script: enables Data Access audit logs for the IAM API
 * (ADMIN_READ — the impersonation signal is blind without it), creates the
 * email notification channel, one log-based metric per signal, and one
 * alerting policy per metric (fires on any match). Safe to rerun: metrics
 * use `update` (creates when missing) and the audit-log merge only appends
 * when the entry is absent. Run once per project that holds remediator SAs.
 */
export function getGcpRemediationDetectionScript(
  options: GcpRemediationDetectionScriptOptions,
): string {
  const projectId = options.projectId.trim();
  // The project id lands inside double-quoted shell strings throughout the
  // script. The pattern allows only lowercase letters, digits, and hyphens
  // (starting with a letter), so a validated id cannot break quoting — and
  // a rejected id fails fast here instead of failing in Cloud Shell.
  if (!SAFE_GCP_PROJECT_PATTERN.test(projectId)) {
    throw new Error(
      `getGcpRemediationDetectionScript requires a valid GCP project id, got "${options.projectId}"`,
    );
  }
  const channelName = options.channelName ?? GCP_REMEDIATION_DETECTION_CHANNEL_NAME;
  const safeEmail = escapeDoubleQuotedShell(options.email);
  const safeChannelName = escapeDoubleQuotedShell(channelName);

  const metricBlock = (rule: GcpRemediationDetectionRule): string[] => {
    const metricId = GCP_REMEDIATION_DETECTION_METRICS[rule];
    const filter = buildGcpDetectionFilter({ rule });
    // `update`, not `create`: update creates the metric when it is missing
    // and replaces it when it exists, so a rerun never aborts under
    // `set -euo pipefail` the way `create` does on an existing metric.
    return [
      `# ${rule} — ${GCP_REMEDIATION_DETECTION_DESCRIPTIONS[rule]}.`,
      `gcloud logging metrics update ${metricId} --description="${GCP_REMEDIATION_DETECTION_DESCRIPTIONS[rule]}" --log-filter='${filter}' --project="$PROJECT"`,
    ];
  };

  const policyBlock = (rule: GcpRemediationDetectionRule): string[] => {
    // Unquoted heredoc: only `$CHANNEL_ID` may expand. The policy JSON and
    // the Logging filters contain no `$` or backticks, so nothing else can
    // expand — a quoted heredoc would leave the channel reference literal.
    const policy = JSON.stringify(buildGcpAlertingPolicy({ rule }), null, 2);
    return [
      `# Alerting policy for ${rule} (fires on any match).`,
      `gcloud alpha monitoring policies create --project="$PROJECT" --policy-from-file=- <<EOF`,
      policy,
      'EOF',
    ];
  };

  // Quoted heredoc: nothing inside expands, so the JSON keys and the
  // `{'logType': ...}` literals reach python untouched.
  const auditLogBlock: string[] = [
    '# 2. Data Access audit logs for the IAM API (ADMIN_READ).',
    '# GenerateAccessToken emits a Data Access log, off by default — without',
    '# this the impersonation metric matches nothing. `iamcredentials` logs',
    '# cannot be enabled on their own; enabling ADMIN_READ for `iam.googleapis.com` covers them.',
    'gcloud projects get-iam-policy "$PROJECT" --format=json > /tmp/opencomp-audit-policy.json',
    `python3 - <<'PYEOF'`,
    'import json',
    "path = '/tmp/opencomp-audit-policy.json'",
    'with open(path) as handle:',
    '    policy = json.load(handle)',
    "configs = policy.setdefault('auditConfigs', [])",
    'for entry in configs:',
    "    if entry.get('service') == 'iam.googleapis.com':",
    "        log_types = entry.setdefault('auditLogConfigs', [])",
    "        if not any(item.get('logType') == 'ADMIN_READ' for item in log_types):",
    "            log_types.append({'logType': 'ADMIN_READ'})",
    '        break',
    'else:',
    '    configs.append(',
    "        {'service': 'iam.googleapis.com', 'auditLogConfigs': [{'logType': 'ADMIN_READ'}]}",
    '    )',
    "with open(path, 'w') as handle:",
    '    json.dump(policy, handle, indent=2)',
    'PYEOF',
    'gcloud projects set-iam-policy "$PROJECT" /tmp/opencomp-audit-policy.json >/dev/null',
    'rm -f /tmp/opencomp-audit-policy.json',
    'echo "Data Access audit logs (ADMIN_READ) enabled for the IAM API."',
  ];

  return [
    'set -euo pipefail',
    '',
    '# 1. Project under watch (holds the remediator SAs).',
    `PROJECT="${projectId}"`,
    '',
    ...auditLogBlock,
    '',
    '# 3. Email notification channel for the alerts.',
    `CHANNEL_ID=$(gcloud beta monitoring channels create --display-name="${safeChannelName}" --type=email --channel-labels=email_address="${safeEmail}" --project="$PROJECT" --format="value(name)")`,
    'echo "Confirm the notification-channel verification email before expecting alerts."',
    '',
    '# 4. One log-based metric per signal.',
    ...GCP_REMEDIATION_DETECTION_RULES.flatMap((rule) => ['', ...metricBlock(rule)]),
    '',
    '# 5. One alerting policy per metric.',
    ...GCP_REMEDIATION_DETECTION_RULES.flatMap((rule) => ['', ...policyBlock(rule)]),
    '',
    'echo "Detection wired. Current metrics:"',
    'gcloud logging metrics list --project="$PROJECT" --filter="name:opencomp-remediator-"',
  ].join('\n');
}
