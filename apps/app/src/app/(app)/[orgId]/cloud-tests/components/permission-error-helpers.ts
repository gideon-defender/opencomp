import {
  AWS_PERMISSION_KEYWORDS,
  buildRemediationGrantScript,
  extractGcpPermissionsFromError,
  extractIamActionsFromErrorMessage,
} from '../lib/remediation-denylist';

/** Extract IAM actions from the error message itself (client-side parsing). */
export function extractActionsFromError(error: string): string[] {
  // AWS patterns live in the shared denylist module so the client parses
  // hyphenated services (e.g. cognito-idp) exactly like the API. GCP
  // patterns live there too — one list, no per-app copy.
  const actions = new Set<string>(extractIamActionsFromErrorMessage(error));
  for (const permission of extractGcpPermissionsFromError(error)) {
    actions.add(permission);
  }
  return [...actions];
}

/**
 * True when the message means "the caller lacks permission" (not some other
 * failure). The AWS core comes from the shared keyword list (same table the
 * API parser uses); the Azure/GCP branches below only add provider signals
 * the AWS list does not cover. Case-insensitive on purpose: AWS mixes
 * `AccessDenied`, `Access Denied`, and `not authorized` across services.
 * Provider-host mentions alone do NOT count — a host token without a
 * permission signal is not proof of a permission problem.
 */
export function isPermissionErrorMessage(error: string): boolean {
  const lowerError = error.toLowerCase();
  if (AWS_PERMISSION_KEYWORDS.some((keyword) => lowerError.includes(keyword))) {
    return true;
  }
  return (
    lowerError.includes('unauthorized') ||
    lowerError.includes('permission_denied') ||
    lowerError.includes('permission denied') ||
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
    // Word boundary on `config`: without it the pattern matches the word
    // "configuration" anywhere before "service-linked role" and
    // misattributes other services' errors (e.g. GuardDuty) to AWS Config,
    // suggesting the wrong create-service-linked-role command.
    pattern: /\bconfig\b.*service-linked role/i,
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

export function buildAwsFixScript(actions: string[], roleName: string): string | null {
  if (actions.length === 0) return null;
  // Single shared builder (same merge shape as the batch scripts and
  // backend scripts). Blocked actions are omitted — never Allow, never
  // Deny (a Deny would override a later manual Allow in the console).
  // When nothing is grantable the builder returns manual-review guidance
  // (not null) so the caller still shows help instead of hiding the block.
  return buildRemediationGrantScript({
    permissions: actions,
    roleName,
    warningLine: ({ display }) =>
      `# WARNING: ${display} require(s) manual review and were NOT granted.`,
  });
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
