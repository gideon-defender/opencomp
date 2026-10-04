import { randomUUID } from 'node:crypto';

/**
 * Server-generated External IDs for AWS connections (Phase 1 item 6).
 *
 * The External ID is the confused-deputy protection on every AWS trust
 * policy we ask customers to create. A customer-typed value (typically the
 * org ID) is guessable, so the server mints an unguessable one per
 * connection: `org_<organizationId>_<randomUUID>`.
 *
 * Rules enforced by the connections controller:
 * - Create: any client-supplied `externalId` is ignored and replaced with a
 *   freshly generated value (which is returned show-once in the response so
 *   the setup UI can inject it into the CloudShell script).
 * - Update: the stored value is pinned — a client-supplied value never
 *   overwrites it (rotation would break the customer's trust policies).
 *   Legacy rows with no stored value adopt an explicit client value when
 *   one is sent, otherwise a fresh value is minted so the update validates.
 */

/**
 * Mint a fresh External ID for one AWS connection. The org-ID prefix keeps
 * values human-attributable in CloudTrail; the random suffix makes them
 * unguessable. The org segment is restricted to characters safe in a shell
 * double-quoted string AND an STS External ID, so the output is safe to
 * interpolate into `EXTERNAL_ID="..."`.
 */
export function generateAwsExternalId(organizationId: string): string {
  const safeOrg = organizationId.replace(/[^A-Za-z0-9_-]/g, '_');
  return `org_${safeOrg}_${randomUUID()}`;
}
