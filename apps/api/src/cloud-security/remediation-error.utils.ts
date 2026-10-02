import { extractIamActionsFromErrorMessage } from './remediation-denylist';

interface PermissionErrorInfo {
  isPermissionError: boolean;
  missingActions: string[];
  rawMessage: string;
}

interface GcpPermissionErrorInfo {
  isPermissionError: boolean;
  missingPermissions: string[];
  suggestedRole: string | null;
  fixScript: string | null;
  rawMessage: string;
}

const PERMISSION_KEYWORDS = [
  'not authorized',
  'accessdenied',
  'accessdeniedexception',
  'access denied',
  'unauthorizedaccess',
  'do not have the required',
  'forbidden',
] as const;

/**
 * Parse an AWS error message to detect permission errors and extract
 * the specific missing IAM action(s).
 *
 * Gracefully degrades: if it detects a permission error but cannot
 * extract the action, `missingActions` will be empty.
 */
export function parseAwsPermissionError(
  errorMessage: string | null | undefined,
): PermissionErrorInfo {
  if (typeof errorMessage !== 'string' || errorMessage.length === 0) {
    return {
      isPermissionError: false,
      missingActions: [],
      rawMessage: '',
    };
  }
  const lower = errorMessage.toLowerCase();
  const isPermissionError = PERMISSION_KEYWORDS.some((kw) =>
    lower.includes(kw),
  );

  if (!isPermissionError) {
    return {
      isPermissionError: false,
      missingActions: [],
      rawMessage: errorMessage,
    };
  }

  // Action extraction lives in the shared denylist module so the API
  // fallback path and the web client parse hyphenated services
  // (e.g. cognito-idp) exactly the same way.
  const actions = extractIamActionsFromErrorMessage(errorMessage);

  return {
    isPermissionError: true,
    missingActions: actions,
    rawMessage: errorMessage,
  };
}

// ─── GCP Permission Error Parsing ──────────────────────────────────────────

/** Map GCP permission prefixes to recommended predefined roles. */
const GCP_PERMISSION_TO_ROLE: Array<{ prefix: string; role: string }> = [
  { prefix: 'storage.', role: 'roles/storage.admin' },
  { prefix: 'compute.firewalls', role: 'roles/compute.securityAdmin' },
  { prefix: 'compute.instances', role: 'roles/compute.instanceAdmin.v1' },
  { prefix: 'compute.subnetworks', role: 'roles/compute.networkAdmin' },
  { prefix: 'compute.networks', role: 'roles/compute.networkAdmin' },
  { prefix: 'compute.', role: 'roles/compute.admin' },
  { prefix: 'cloudsql.', role: 'roles/cloudsql.admin' },
  { prefix: 'cloudkms.', role: 'roles/cloudkms.admin' },
  { prefix: 'logging.', role: 'roles/logging.admin' },
  { prefix: 'dns.', role: 'roles/dns.admin' },
  { prefix: 'container.', role: 'roles/container.admin' },
  { prefix: 'iam.', role: 'roles/iam.securityAdmin' },
  { prefix: 'resourcemanager.', role: 'roles/resourcemanager.projectIamAdmin' },
  { prefix: 'pubsub.', role: 'roles/pubsub.admin' },
  { prefix: 'bigquery.', role: 'roles/bigquery.admin' },
];

/** GCP permission extraction patterns. */
const GCP_PERMISSION_PATTERNS: RegExp[] = [
  // "Permission denied: caller does not have permission 'storage.buckets.update'"
  /permission\s+'([\w.]+)'/i,
  // From metadata: "permission": "storage.buckets.update"
  /"permission":\s*"([\w.]+)"/i,
  // "required permission(s): storage.buckets.update"
  /required permission[s]?:\s*([\w.]+)/i,
  // GCP format: "does not have storage.buckets.update access"
  /does not have\s+([\w.]+)\s+access/i,
  // Inline: Permission 'compute.firewalls.update' denied
  /'([\w.]+)'\s*denied/i,
];

/**
 * Parse a GCP API error to detect permission errors, extract the missing
 * permission, suggest a role, and generate a ready-to-paste gcloud command.
 */
export function parseGcpPermissionError(
  errorMessage: string | null | undefined,
  projectId?: string,
): GcpPermissionErrorInfo {
  if (typeof errorMessage !== 'string' || errorMessage.length === 0) {
    return {
      isPermissionError: false,
      missingPermissions: [],
      suggestedRole: null,
      fixScript: null,
      rawMessage: '',
    };
  }
  const lower = errorMessage.toLowerCase();
  const isPermissionError =
    lower.includes('permission_denied') ||
    lower.includes('permission denied') ||
    lower.includes('does not have') ||
    (lower.includes('403') && lower.includes('permission'));

  if (!isPermissionError) {
    return {
      isPermissionError: false,
      missingPermissions: [],
      suggestedRole: null,
      fixScript: null,
      rawMessage: errorMessage,
    };
  }

  // Extract the specific permission
  const permissions = new Set<string>();
  for (const pattern of GCP_PERMISSION_PATTERNS) {
    const match = errorMessage.match(pattern);
    if (match?.[1]) permissions.add(match[1]);
  }

  // Find best matching role
  const permList = [...permissions];
  let suggestedRole: string | null = null;
  for (const perm of permList) {
    const entry = GCP_PERMISSION_TO_ROLE.find((r) => perm.startsWith(r.prefix));
    if (entry) {
      suggestedRole = entry.role;
      break;
    }
  }

  // Build gcloud fix script
  let fixScript: string | null = null;
  if (suggestedRole) {
    const project = projectId ?? 'YOUR_PROJECT_ID';
    fixScript = [
      'gcloud projects add-iam-policy-binding ' + project,
      "  --member='user:YOUR_EMAIL'",
      `  --role='${suggestedRole}'`,
    ].join(' \\\n');
  }

  return {
    isPermissionError: true,
    missingPermissions: permList,
    suggestedRole,
    fixScript,
    rawMessage: errorMessage,
  };
}

interface AzurePermissionErrorInfo {
  isPermissionError: boolean;
  missingActions: string[];
  fixScript: string | null;
  rawMessage: string;
}

/**
 * Parse an Azure API error to detect permission (403/AuthorizationFailed) errors.
 */
export function parseAzurePermissionError(
  errorMessage: string | null | undefined,
): AzurePermissionErrorInfo {
  if (typeof errorMessage !== 'string' || errorMessage.length === 0) {
    return {
      isPermissionError: false,
      missingActions: [],
      fixScript: null,
      rawMessage: '',
    };
  }
  const lower = errorMessage.toLowerCase();
  // Match real auth failures only: bare "403" also hits IDs/timestamps,
  // so require an auth keyword alongside the status code.
  const has403WithAuthContext =
    (lower.includes('403') || lower.includes('forbidden')) &&
    (lower.includes('authorization') ||
      lower.includes('authenticated') ||
      lower.includes('permission') ||
      lower.includes('access'));
  const isPermissionError =
    lower.includes('authorizationfailed') ||
    lower.includes('authorization failed') ||
    lower.includes('does not have authorization') ||
    has403WithAuthContext;

  if (!isPermissionError) {
    return {
      isPermissionError: false,
      missingActions: [],
      fixScript: null,
      rawMessage: errorMessage,
    };
  }

  // Try to extract action from Azure error: "does not have authorization to perform action 'X' over scope"
  const actionMatch = errorMessage.match(/perform action '([^']+)'/);
  const missingActions = actionMatch ? [actionMatch[1]] : [];

  const fixScript =
    missingActions.length > 0
      ? [
          'az role assignment create \\',
          "  --assignee '<app-registration-object-id>' \\",
          "  --role 'Contributor' \\",
          "  --scope '/subscriptions/<subscription-id>'",
        ].join('\n')
      : null;

  return {
    isPermissionError: true,
    missingActions,
    fixScript,
    rawMessage: errorMessage,
  };
}
