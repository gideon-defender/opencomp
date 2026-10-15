import { ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { redisClient } from '../redis/redis.client';
import { isBootstrapEnforced } from './oidc-gates';

const proofSchema = z.object({ userId: z.string(), tenantId: z.string() });
const proofKey = (sessionId: string) => `app:gideon-bootstrap:${sessionId}`;

export async function recordBootstrapOwner({
  sessionId,
  userId,
  tenantId,
  expiresAt,
}: {
  sessionId: string;
  userId: string;
  tenantId: string;
  expiresAt: Date;
}): Promise<void> {
  await redisClient.set(
    proofKey(sessionId),
    { userId, tenantId },
    {
      ex: Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)),
    },
  );
}

/** Old sessions cannot acquire owner proof when the rollout flag changes. */
export async function authorizeBootstrapSession({
  sessionId,
  userId,
  tenantId,
}: {
  sessionId: string;
  userId: string;
  tenantId: string;
}): Promise<void> {
  if (!isBootstrapEnforced()) return;
  const proof = proofSchema.safeParse(
    await redisClient.get(proofKey(sessionId)),
  );
  if (
    proof.success &&
    proof.data.userId === userId &&
    proof.data.tenantId === tenantId
  )
    return;
  throw new ForbiddenException(
    'Sign in again with a Gideon owner assignment before creating an organization.',
  );
}
