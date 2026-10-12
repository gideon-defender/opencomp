import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { db } from '@db';
import { NativeSessionService } from '../auth/native-session.service';
import { deviceAgentRedisClient } from './device-agent-kv';
import { createDeviceAgentSession } from './device-agent-session.helper';
import {
  registerWithSerial,
  registerWithoutSerial,
} from './device-registration.helpers';
import { RegisterDeviceDto } from './dto/register-device.dto';
import type { CheckInDto } from './dto/check-in.dto';
import { submitDeviceCheckIn } from './device-agent-check-in';

interface StoredAuthCode {
  userId: string;
  state: string;
  createdAt: number;
}

@Injectable()
export class DeviceAgentAuthService {
  private readonly logger = new Logger(DeviceAgentAuthService.name);

  constructor(
    // @Inject keeps the runtime reference (the Pick<> type alone would be
    // elided, leaving Nest an undefined token). @Optional preserves the
    // manual-construction path used in unit tests.
    @Optional()
    @Inject(NativeSessionService)
    private readonly nativeSessionService?: Pick<
      NativeSessionService,
      'resolveFromHeaders'
    >,
  ) {}

  private get sessions(): Pick<NativeSessionService, 'resolveFromHeaders'> {
    // Nest injects the real service in production; specs construct the
    // service without args, in which case there is nothing to resolve
    // against and callers get the unauthenticated path.
    return (
      this.nativeSessionService ?? {
        resolveFromHeaders: () => Promise.resolve(null),
      }
    );
  }

  async generateAuthCode({
    headers,
    state,
  }: {
    headers: Headers;
    state: string;
  }) {
    // Milestone 3 — resolve the browser session natively (Session-row
    // lookup) instead of better-auth's getSession.
    const resolved = await this.sessions.resolveFromHeaders({
      cookieHeader: headers.get('cookie') ?? undefined,
      authHeader: headers.get('authorization') ?? undefined,
    });

    if (!resolved?.user) {
      throw new UnauthorizedException('No active session');
    }

    const code = randomBytes(32).toString('hex');

    await deviceAgentRedisClient.set(
      `app:device-auth:${code}`,
      {
        userId: resolved.user.id,
        state,
        createdAt: Date.now(),
      },
      { ex: 120 },
    );

    return { code };
  }

  async exchangeCode({ code }: { code: string }) {
    const stored = await deviceAgentRedisClient.getdel<StoredAuthCode>(
      `app:device-auth:${code}`,
    );

    if (!stored) {
      throw new UnauthorizedException('Invalid or expired authorization code');
    }

    const session = await createDeviceAgentSession({ userId: stored.userId });

    return {
      session_token: session.token,
      user_id: stored.userId,
    };
  }

  async getMyOrganizations({ userId }: { userId: string }) {
    const memberships = await db.member.findMany({
      where: { userId, deactivated: false, idpAccessRevoked: false },
      include: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    const organizations = memberships.map((m) => ({
      organizationId: m.organization.id,
      organizationName: m.organization.name,
      organizationSlug: m.organization.slug,
      role: m.role,
    }));

    return { organizations };
  }

  async registerDevice({
    userId,
    sessionId,
    dto,
  }: {
    userId: string;
    sessionId: string;
    dto: RegisterDeviceDto;
  }) {
    const member = await db.member.findFirst({
      where: {
        userId,
        organizationId: dto.organizationId,
        deactivated: false,
        idpAccessRevoked: false,
      },
    });

    if (!member) {
      throw new ForbiddenException('Not a member of this organization');
    }

    const device = dto.serialNumber
      ? await registerWithSerial({ member, dto })
      : await registerWithoutSerial({ member, dto });

    if (device.agentSessionId && device.agentSessionId !== sessionId) {
      try {
        await db.session.delete({ where: { id: device.agentSessionId } });
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2025') {
          this.logger.error(
            `Failed to delete stale agent session ${device.agentSessionId} for device ${device.id}: ${err}`,
          );
          throw err;
        }
      }
    }

    await db.device.update({
      where: { id: device.id },
      data: { agentSessionId: sessionId },
    });

    return { deviceId: device.id };
  }

  async checkIn(params: {
    userId: string;
    sessionId: string;
    sessionDeviceAgent: boolean;
    dto: CheckInDto;
  }) {
    return submitDeviceCheckIn({ ...params, logger: this.logger });
  }

  async revokeAgentAccess({
    organizationId,
    deviceId,
  }: {
    organizationId: string;
    deviceId: string;
  }): Promise<void> {
    const device = await db.device.findFirst({
      where: { id: deviceId, organizationId },
      select: { id: true, agentSessionId: true },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (!device.agentSessionId) {
      return;
    }

    try {
      await db.session.delete({ where: { id: device.agentSessionId } });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2025') {
        this.logger.error(
          `Failed to revoke agent session ${device.agentSessionId} for device ${device.id}: ${err}`,
        );
        throw err;
      }
    }
  }

  async getDeviceStatus({
    userId,
    deviceId,
    organizationId,
  }: {
    userId: string;
    deviceId?: string;
    organizationId?: string;
  }) {
    if (!deviceId) {
      const devices = await db.device.findMany({
        where: {
          member: { userId, deactivated: false, idpAccessRevoked: false },
          ...(organizationId ? { organizationId } : {}),
        },
        orderBy: { installedAt: 'desc' },
      });

      return { devices };
    }

    const device = await db.device.findFirst({
      where: {
        id: deviceId,
        member: { userId, deactivated: false, idpAccessRevoked: false },
      },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return { device };
  }
}
