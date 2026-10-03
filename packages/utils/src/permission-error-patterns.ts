/**
 * Shared permission-error signals for the API parser and the web client.
 *
 * Split out of `remediation-denylist.ts` so that module stays under the
 * 300-line limit. Both sides re-export this module — do NOT copy the
 * lists into app code.
 */

/**
 * Lowercase fragments that mark an AWS error as a permission failure.
 * Single source for the API parser and the web client — the client's
 * broader check layers Azure/GCP signals on top of this list, so every
 * AWS keyword edit belongs here, not in a second copy.
 */
export const AWS_PERMISSION_KEYWORDS = [
  'not authorized',
  'accessdenied',
  'accessdeniedexception',
  'access denied',
  'unauthorizedaccess',
  'do not have the required',
  'forbidden',
] as const;

/**
 * Shared GCP permission-extraction patterns. The API parser runs these
 * plus its two metadata-shaped extras; the web client runs exactly these.
 * Every new pattern belongs here, not in a per-app copy.
 */
const SHARED_GCP_PERMISSION_PATTERNS: RegExp[] = [
  // "Permission denied: caller does not have permission 'storage.buckets.update'"
  /permission\s+'([\w.]+)'/i,
  // GCP format: "does not have storage.buckets.update access"
  /does not have\s+([\w.]+)\s+access/i,
  // Inline: Permission 'compute.firewalls.update' denied
  /'([\w.]+)'\s*denied/i,
];

/**
 * Extracts GCP `service.permission` tokens from an error message.
 * Returns deduped permissions in first-seen order.
 */
export function extractGcpPermissionsFromError(error: string): string[] {
  if (typeof error !== 'string' || error.length === 0) return [];
  const permissions: string[] = [];
  const seen = new Set<string>();
  for (const pattern of SHARED_GCP_PERMISSION_PATTERNS) {
    const match = error.match(pattern);
    if (match?.[1] && !seen.has(match[1])) {
      seen.add(match[1]);
      permissions.push(match[1]);
    }
  }
  return permissions;
}
