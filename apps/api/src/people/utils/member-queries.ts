import { db } from '@db';
import type { PeopleResponseDto } from '../dto/people-responses.dto';
import { MEMBER_SELECT } from './member-select';

/**
 * Common database queries for member operations
 */
export class MemberQueries {
  static readonly MEMBER_SELECT = MEMBER_SELECT;

  /**
   * Get all members for an organization
   */
  static async findAllByOrganization(
    organizationId: string,
    includeDeactivated = false,
    filters?: {
      onboardAfter?: Date;
      onboardBefore?: Date;
      offboardAfter?: Date;
      offboardBefore?: Date;
    },
  ): Promise<PeopleResponseDto[]> {
    return db.member.findMany({
      where: {
        organizationId,
        ...(includeDeactivated ? {} : { deactivated: false, isActive: true }),
        ...(filters?.onboardAfter || filters?.onboardBefore
          ? {
              onboardDate: {
                ...(filters.onboardAfter ? { gte: filters.onboardAfter } : {}),
                ...(filters.onboardBefore
                  ? { lte: filters.onboardBefore }
                  : {}),
              },
            }
          : {}),
        ...(filters?.offboardAfter || filters?.offboardBefore
          ? {
              offboardDate: {
                ...(filters.offboardAfter
                  ? { gte: filters.offboardAfter }
                  : {}),
                ...(filters.offboardBefore
                  ? { lte: filters.offboardBefore }
                  : {}),
              },
            }
          : {}),
      },
      select: this.MEMBER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find a member by ID within an organization
   */
  static async findByIdInOrganization(
    memberId: string,
    organizationId: string,
    options?: { includeDeactivated?: boolean },
  ): Promise<PeopleResponseDto | null> {
    return db.member.findFirst({
      where: {
        id: memberId,
        organizationId,
        ...(options?.includeDeactivated ? {} : { deactivated: false }),
      },
      select: this.MEMBER_SELECT,
    });
  }

  /**
   * Unlink device by resetting fleetDmLabelId to null within an organization
   */
  static async unlinkDevice(
    memberId: string,
    organizationId: string,
  ): Promise<PeopleResponseDto> {
    return db.member.update({
      where: { id: memberId, organizationId },
      data: { fleetDmLabelId: null },
      select: this.MEMBER_SELECT,
    });
  }
}
