import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { db } from '@db';
import { FleetService } from '../lib/fleet.service';
import { BUILT_IN_ROLE_PERMISSIONS } from '@gideon-defender/auth';
import type { PeopleResponseDto } from './dto/people-responses.dto';
import { updateUserEmailPreferences } from './utils/update-email-preferences';
import { getUserEmailPreferences } from './utils/get-email-preferences';
import { MemberValidator } from './utils/member-validator';
import { MemberQueries } from './utils/member-queries';

@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);

  constructor(private readonly fleetService: FleetService) {}

  async findAllByOrganization(
    organizationId: string,
    includeDeactivated?: boolean,
    filters?: {
      onboardAfter?: Date;
      onboardBefore?: Date;
      offboardAfter?: Date;
      offboardBefore?: Date;
    },
  ): Promise<PeopleResponseDto[]> {
    try {
      await MemberValidator.validateOrganization(organizationId);
      const members = await MemberQueries.findAllByOrganization(
        organizationId,
        includeDeactivated,
        filters,
      );

      this.logger.log(
        `Retrieved ${members.length} members for organization ${organizationId}`,
      );
      return members;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to retrieve members for organization ${organizationId}:`,
        error,
      );
      throw new Error(`Failed to retrieve members: ${error.message}`);
    }
  }

  async findMentionableMembers(
    organizationId: string,
    resource: string,
  ): Promise<PeopleResponseDto[]> {
    const members = await MemberQueries.findAllByOrganization(
      organizationId,
      false,
    );

    // Collect all unique role names across members
    const allRoleNames = new Set<string>();
    for (const member of members) {
      const roles = member.role
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      for (const role of roles) {
        allRoleNames.add(role);
      }
    }

    // Batch-resolve permissions: built-in from constants, custom from DB
    const builtInRoleNames = [...allRoleNames].filter(
      (name) => BUILT_IN_ROLE_PERMISSIONS[name] !== undefined,
    );
    const customRoleNames = [...allRoleNames].filter(
      (name) => BUILT_IN_ROLE_PERMISSIONS[name] === undefined,
    );

    // Build permission map for all roles
    const permissionMap = new Map<string, Record<string, string[]>>();
    for (const name of builtInRoleNames) {
      permissionMap.set(name, BUILT_IN_ROLE_PERMISSIONS[name]);
    }

    // Batch-fetch custom role permissions in one query
    if (customRoleNames.length > 0) {
      const customRoles = await db.organizationRole.findMany({
        where: { organizationId, name: { in: customRoleNames } },
      });
      for (const role of customRoles) {
        const perms =
          typeof role.permissions === 'string'
            ? (JSON.parse(role.permissions) as Record<string, string[]>)
            : (role.permissions as Record<string, string[]>);
        permissionMap.set(role.name, perms);
      }
    }

    // Filter members whose combined permissions include the required permission
    return members.filter((member) => {
      const roles = member.role
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      for (const role of roles) {
        const perms = permissionMap.get(role);
        if (perms && perms[resource]?.includes('read')) {
          return true;
        }
      }
      return false;
    });
  }

  async findById(
    memberId: string,
    organizationId: string,
  ): Promise<PeopleResponseDto> {
    try {
      await MemberValidator.validateOrganization(organizationId);
      const member = await MemberQueries.findByIdInOrganization(
        memberId,
        organizationId,
      );

      if (!member) {
        throw new NotFoundException(
          `Member with ID ${memberId} not found in organization ${organizationId}`,
        );
      }

      this.logger.log(`Retrieved member: ${member.user.name} (${memberId})`);
      return member;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to retrieve member ${memberId} in organization ${organizationId}:`,
        error,
      );
      throw new Error(`Failed to retrieve member: ${error.message}`);
    }
  }

  async unlinkDevice(
    memberId: string,
    organizationId: string,
  ): Promise<PeopleResponseDto> {
    try {
      await MemberValidator.validateOrganization(organizationId);
      const existingMember = await MemberQueries.findByIdInOrganization(
        memberId,
        organizationId,
      );

      if (!existingMember) {
        throw new NotFoundException(
          `Member with ID ${memberId} not found in organization ${organizationId}`,
        );
      }

      // Remove hosts from FleetDM before unlinking the device
      if (existingMember.fleetDmLabelId) {
        try {
          const removalResult = await this.fleetService.removeHostsByLabel(
            existingMember.fleetDmLabelId,
          );
          this.logger.log(
            `Removed ${removalResult.deletedCount} host(s) from FleetDM for label ${existingMember.fleetDmLabelId}`,
          );
          if (removalResult.failedCount > 0) {
            this.logger.warn(
              `Failed to remove ${removalResult.failedCount} host(s) from FleetDM`,
            );
          }
        } catch (fleetError) {
          // Log FleetDM error but don't fail the entire operation
          this.logger.error(
            `Failed to remove hosts from FleetDM for label ${existingMember.fleetDmLabelId}:`,
            fleetError,
          );
          // Continue with unlinking the device even if FleetDM removal fails
        }
      }

      // Also delete device-agent Device records for this member
      try {
        const deleteResult = await db.device.deleteMany({
          where: {
            memberId,
            organizationId,
          },
        });
        if (deleteResult.count > 0) {
          this.logger.log(
            `Deleted ${deleteResult.count} device-agent device(s) for member ${memberId} in org ${organizationId}`,
          );
        }
      } catch (deviceError) {
        // Log but don't fail the operation
        this.logger.error(
          `Failed to delete device-agent devices for member ${memberId}:`,
          deviceError,
        );
      }

      const updatedMember = await MemberQueries.unlinkDevice(
        memberId,
        organizationId,
      );

      this.logger.log(
        `Unlinked device for member: ${updatedMember.user.name} (${memberId})`,
      );
      return updatedMember;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to unlink device for member ${memberId} in organization ${organizationId}:`,
        error,
      );
      throw new Error(`Failed to unlink device: ${error.message}`);
    }
  }

  async removeHostById(
    memberId: string,
    organizationId: string,
    hostId: number,
  ): Promise<{ success: true }> {
    try {
      await MemberValidator.validateOrganization(organizationId);
      const member = await MemberQueries.findByIdInOrganization(
        memberId,
        organizationId,
      );

      if (!member) {
        throw new NotFoundException(
          `Member with ID ${memberId} not found in organization ${organizationId}`,
        );
      }

      if (!member.fleetDmLabelId) {
        throw new BadRequestException(
          `Member ${memberId} has no Fleet label; cannot remove host`,
        );
      }

      const labelHosts = await this.fleetService.getHostsByLabel(
        member.fleetDmLabelId,
      );
      const hostIds = (labelHosts?.hosts ?? []).map(
        (host: { id: number }) => host.id,
      );
      if (!hostIds.includes(hostId)) {
        throw new NotFoundException(
          `Host ${hostId} not found for member ${memberId} in organization ${organizationId}`,
        );
      }

      await this.fleetService.removeHostById(hostId);

      this.logger.log(
        `Removed host ${hostId} from FleetDM for member ${memberId} in organization ${organizationId}`,
      );
      return { success: true };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to remove host ${hostId} for member ${memberId} in organization ${organizationId}:`,
        error,
      );
      throw new Error(`Failed to remove host: ${error.message}`);
    }
  }

  async getDevices(organizationId: string) {
    return db.device.findMany({
      where: { organizationId },
      include: { member: { include: { user: true } } },
      orderBy: { installedAt: 'desc' },
    });
  }

  async getTestStatsByAssignee(organizationId: string) {
    const tasks = await db.task.findMany({
      where: { organizationId },
      select: { assigneeId: true, status: true },
    });
    const stats = new Map<string, { total: number; done: number }>();
    for (const task of tasks) {
      if (!task.assigneeId) continue;
      const existing = stats.get(task.assigneeId) || { total: 0, done: 0 };
      existing.total++;
      if (task.status === 'done') existing.done++;
      stats.set(task.assigneeId, existing);
    }
    return Object.fromEntries(stats);
  }

  async getTrainingVideos(memberId: string, organizationId: string) {
    const member = await db.member.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!member) throw new NotFoundException('Member not found');
    return db.employeeTrainingVideoCompletion.findMany({
      where: { memberId },
      orderBy: { completedAt: 'desc' },
    });
  }

  async getFleetCompliance(memberId: string, organizationId: string) {
    const member = await db.member.findFirst({
      where: { id: memberId, organizationId },
      select: { id: true, userId: true, fleetDmLabelId: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (!member.fleetDmLabelId) return { hosts: [], policyResults: [] };

    const [hosts, policyResults] = await Promise.all([
      this.fleetService
        .getHostsByLabel(member.fleetDmLabelId)
        .then((r) => r?.hosts ?? []),
      db.fleetPolicyResult.findMany({
        where: { userId: member.userId, organizationId },
      }),
    ]);
    return { hosts, policyResults };
  }

  async getEmailPreferences(
    userId: string,
    userEmail: string,
    _organizationId: string,
  ) {
    return getUserEmailPreferences({ userId, userEmail });
  }

  async updateEmailPreferences(
    userId: string,
    preferences: Record<string, boolean | undefined>,
  ) {
    return updateUserEmailPreferences({ userId, preferences });
  }
}
