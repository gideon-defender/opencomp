import { NotFoundException, type Logger } from '@nestjs/common';
import { db, Prisma } from '@db';
import { createDeviceAgentSession } from './device-agent-session.helper';
import type { CheckInDto } from './dto/check-in.dto';

const CHECK_TYPE_TO_FIELD: Record<string, string> = {
  disk_encryption: 'diskEncryptionEnabled',
  antivirus: 'antivirusEnabled',
  password_policy: 'passwordPolicySet',
  screen_lock: 'screenLockEnabled',
};

export async function submitDeviceCheckIn({
  userId,
  sessionId,
  sessionDeviceAgent,
  dto,
  logger,
}: {
  userId: string;
  sessionId: string;
  sessionDeviceAgent: boolean;
  dto: CheckInDto;
  logger: Logger;
}) {
  const device = await db.device.findFirst({
    where: {
      id: dto.deviceId,
      member: { userId, deactivated: false, idpAccessRevoked: false },
    },
  });

  if (!device) {
    throw new NotFoundException('Device not found');
  }

  const checkFields: Record<string, boolean> = {
    diskEncryptionEnabled: device.diskEncryptionEnabled,
    antivirusEnabled: device.antivirusEnabled,
    passwordPolicySet: device.passwordPolicySet,
    screenLockEnabled: device.screenLockEnabled,
  };

  const checkDetails: Record<string, unknown> =
    (device.checkDetails as Record<string, unknown>) ?? {};

  for (const check of dto.checks) {
    const field = CHECK_TYPE_TO_FIELD[check.checkType];
    if (field) {
      checkFields[field] = check.passed;
    }
    checkDetails[check.checkType] = {
      ...check.details,
      passed: check.passed,
      checkedAt: check.checkedAt,
    };
  }

  const isCompliant =
    checkFields.diskEncryptionEnabled &&
    checkFields.antivirusEnabled &&
    checkFields.passwordPolicySet &&
    checkFields.screenLockEnabled;

  let upgradedSessionToken: string | undefined;
  let sessionIdToLink: string | undefined;

  if (!sessionDeviceAgent) {
    if (device.agentSessionId) {
      try {
        await db.session.delete({ where: { id: device.agentSessionId } });
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2025') {
          logger.error(
            `Failed to delete stale agent session ${device.agentSessionId} for device ${device.id}: ${err}`,
          );
          throw err;
        }
      }
    }
    const upgraded = await createDeviceAgentSession({ userId });
    upgradedSessionToken = upgraded.token;
    sessionIdToLink = upgraded.sessionId;
  } else if (device.agentSessionId !== sessionId) {
    sessionIdToLink = sessionId;
  }

  await db.device.update({
    where: { id: dto.deviceId },
    data: {
      ...checkFields,
      checkDetails: checkDetails as Prisma.InputJsonValue,
      isCompliant,
      lastCheckIn: new Date(),
      // A check-in means the endpoint agent is actively managing this device,
      // so assert agent ownership. Heals a row that was imported by an
      // integration and adopted by the agent but left source='integration'
      // (which hid the compliant device as "Missing" in the People tab).
      source: 'agent',
      ...(dto.agentVersion ? { agentVersion: dto.agentVersion } : {}),
      ...(sessionIdToLink !== undefined
        ? { agentSessionId: sessionIdToLink }
        : {}),
    },
  });

  return {
    isCompliant,
    nextCheckIn: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ...(upgradedSessionToken ? { upgradedSessionToken } : {}),
  };
}
