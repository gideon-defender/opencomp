/**
 * Session and ownership checks shared by task-automation-actions.ts. Every
 * exported action there is a publicly-invocable Next.js Server Action RPC,
 * so callers MUST resolve the session first and fail closed when it's
 * missing or the resource doesn't belong to the caller's organization.
 */

import { auth } from '@/utils/auth';
import { db } from '@db/server';
import { client } from '@gideon-defender/kv';
import { headers } from 'next/headers';

export async function getActiveOrganizationId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });

  return session?.session.activeOrganizationId ?? null;
}

/**
 * Check that an automation (identified only by its own id, with no orgId
 * supplied by the caller) belongs to the given organization, by following
 * automation -> task -> organizationId.
 */
export async function isAutomationInOrganization({
  automationId,
  organizationId,
}: {
  automationId: string;
  organizationId: string;
}): Promise<boolean> {
  const automation = await db.evidenceAutomation.findUnique({
    where: { id: automationId },
    select: { task: { select: { organizationId: true } } },
  });

  return automation?.task.organizationId === organizationId;
}

// Enterprise/trigger run ids have no local DB row to scope by, so ownership
// is tracked in KV (set when the run is started, checked on every status
// read) instead. TTL just needs to outlast how long a test run is polled.
const AUTOMATION_RUN_OWNER_TTL_SECONDS = 60 * 60 * 24;
const automationRunOwnerKey = (runId: string) => `app:automation-run-owner:${runId}`;

export async function recordAutomationRunOwner(
  runId: string,
  organizationId: string,
): Promise<void> {
  try {
    await client.set(automationRunOwnerKey(runId), organizationId, {
      ex: AUTOMATION_RUN_OWNER_TTL_SECONDS,
    });
  } catch (error) {
    console.error('[recordAutomationRunOwner] Failed to record run owner:', error);
  }
}

export async function isRunOwnedByOrganization(
  runId: string,
  organizationId: string,
): Promise<boolean> {
  try {
    const owner = await client.get<string>(automationRunOwnerKey(runId));
    return owner === organizationId;
  } catch (error) {
    console.error('[isRunOwnedByOrganization] Failed to verify run owner:', error);
    return false;
  }
}
