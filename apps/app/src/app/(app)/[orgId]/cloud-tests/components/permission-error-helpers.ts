import {
  extractIamActionsFromErrorMessage,
  formatBlockedActionsForDisplay,
  rolePolicyMergeScriptLines,
  splitBlockedRemediationActions,
} from '../lib/remediation-denylist';

/** Extract IAM actions from the error message itself (client-side parsing). */
export function extractActionsFromError(error: string): string[] {
  // AWS patterns live in the shared denylist module so the client parses
  // hyphenated services (e.g. cognito-idp) exactly like the API.
  const actions = new Set<string>(extractIamActionsFromErrorMessage(error));
  const gcpPatterns = [
    // GCP patterns
    /permission\s+'([\w.]+)'/i,
    /does not have\s+([\w.]+)\s+access/i,
    /'([\w.]+)'\s*denied/i,
  ];
  for (const pattern of gcpPatterns) {
    const match = error.match(pattern);
    if (match?.[1]) actions.add(match[1]);
  }
  return [...actions];
}

/**
 * True when the message means "the caller lacks permission" (not some other
 * failure). Case-insensitive on purpose: AWS mixes `AccessDenied`,
 * `Access Denied`, and `not authorized` across services, and Azure/GCP add
 * `AuthorizationFailed`, `UnauthorizedAccess`, and `does not have ... access`.
 * Provider-host mentions alone do NOT count — a host token without a
 * permission signal is not proof of a permission problem.
 */
export function isPermissionErrorMessage(error: string): boolean {
  const lowerError = error.toLowerCase();
  return (
    lowerError.includes('not authorized') ||
    lowerError.includes('unauthorized') ||
    lowerError.includes('accessdenied') ||
    lowerError.includes('access denied') ||
    lowerError.includes('permission_denied') ||
    lowerError.includes('permission denied') ||
    lowerError.includes('forbidden') ||
    error.includes('AuthorizationFailed') ||
    error.includes('does not have authorization') ||
    /does not have\s+[\w.]+\s+access/i.test(error) ||
    /'[\w.]+'\s*denied/i.test(error) ||
    // Bare "required"+"permission" substrings match plain validation text
    // ("Permission field is required") — require an action-like token
    // between them, mirroring the backend extractor.
    /required\s+[\w.:*'"]+\s+permission/i.test(error)
  );
}

/** Known AWS service-linked role patterns. */
const SERVICE_LINKED_ROLE_PATTERNS: { pattern: RegExp; service: string; command: string }[] = [
  {
    pattern: /config.*service-linked role/i,
    service: 'AWS Config',
    command: 'aws iam create-service-linked-role --aws-service-name config.amazonaws.com',
  },
  {
    pattern: /guardduty.*service-linked role|service-linked role.*guardduty/i,
    service: 'GuardDuty',
    command: 'aws iam create-service-linked-role --aws-service-name guardduty.amazonaws.com',
  },
  {
    pattern: /inspector.*service-linked role/i,
    service: 'Inspector',
    command: 'aws iam create-service-linked-role --aws-service-name inspector2.amazonaws.com',
  },
  {
    pattern: /macie.*service-linked role/i,
    service: 'Macie',
    command: 'aws iam create-service-linked-role --aws-service-name macie.amazonaws.com',
  },
];

export interface ServiceLinkedRoleMatch {
  service: string;
  command: string;
}

export function detectServiceLinkedRole(error: string): ServiceLinkedRoleMatch | null {
  if (!error.toLowerCase().includes('service-linked role')) return null;
  for (const entry of SERVICE_LINKED_ROLE_PATTERNS) {
    if (entry.pattern.test(error)) return entry;
  }
  return null;
}

export function buildAwsFixScript(actions: string[]): string | null {
  if (actions.length === 0) return null;
  // Omit denylisted actions — never Allow, never Deny (a Deny would
  // override a later manual Allow in the console). When nothing is
  // grantable, return a manual-review comment (not null) so the caller
  // still shows guidance instead of silently hiding the script block.
  const { allowed, blocked } = splitBlockedRemediationActions(actions);
  if (allowed.length === 0) {
    return `# No grantable permissions — every requested action (${blocked.length}) requires manual review and cannot be added via auto-fix: ${formatBlockedActionsForDisplay(blocked)}`;
  }
  // Read-merge-write against the full policy document so running the
  // script never wipes Deny statements, Conditions, or scoped Resources
  // (same shared merge shape as the batch scripts and backend scripts).
  const command = [
    'ROLE="OpenComp-Remediator" POLICY="OpenComp-AutoFix"',
    `NEW='${JSON.stringify(allowed)}'`,
    ...rolePolicyMergeScriptLines('NEW'),
  ].join('\n');
  if (blocked.length === 0) return command;
  return `# WARNING: ${formatBlockedActionsForDisplay(blocked)} require(s) manual review and were NOT granted.\n${command}`;
}

/**
 * Host-like token matchers (CodeQL js/incomplete-hostname-regexp):
 * static literals with escaped dots — never built from strings via
 * `new RegExp`. The boundary classes ensure "management.azure.com"
 * is matched as a host token, so "management.azure.com.evil.com"
 * does NOT count.
 */
const AZURE_MANAGEMENT_HOST = /(?:^|[^A-Za-z0-9.-])management\.azure\.com(?![A-Za-z0-9.-])/i;
const GCP_APIS_HOST = /(?:^|[^A-Za-z0-9.-])googleapis\.com(?![A-Za-z0-9.-])/i;

export function isAzureError(error: string): boolean {
  return (
    error.includes('AuthorizationFailed') ||
    AZURE_MANAGEMENT_HOST.test(error) ||
    error.includes('does not have authorization')
  );
}

export function isGcpError(error: string): boolean {
  return (
    error.includes('PERMISSION_DENIED') ||
    GCP_APIS_HOST.test(error) ||
    /does not have\s+[\w.]+\s+access/i.test(error) ||
    /permission\s+'[\w.]+'/i.test(error)
  );
}
