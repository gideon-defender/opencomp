import { randomBytes } from 'node:crypto';
import { db } from '@db';
import { resolveActiveOrganizationId } from '../auth/oidc-provisioning';

/** One year in milliseconds. */
export const DEVICE_AGENT_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

interface CreatedDeviceAgentSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

/**
 * Create a dedicated long-lived session for a device agent.
 *
 * Milestone 3 — writes the `Session` row directly instead of going through
 * better-auth's internal session adapter. The row carries the same fields
 * the adapter used to set (`activeOrganizationId` via the shared
 * most-recent-org rule, `deviceAgent: true`, 1-year expiry), so
 * `HybridAuthGuard`'s native session resolution accepts the token unchanged.
 */
export async function createDeviceAgentSession({
  userId,
}: {
  userId: string;
}): Promise<CreatedDeviceAgentSession> {
  const expiresAt = new Date(Date.now() + DEVICE_AGENT_SESSION_TTL_MS);

  const session = await db.session.create({
    data: {
      token: randomBytes(32).toString('hex'),
      userId,
      expiresAt,
      activeOrganizationId: await resolveActiveOrganizationId({ userId }),
      deviceAgent: true,
    },
  });

  return {
    sessionId: session.id,
    token: session.token,
    expiresAt: session.expiresAt,
  };
}
