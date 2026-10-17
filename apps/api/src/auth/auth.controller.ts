import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiExcludeController,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { db } from '@db';
import { OrganizationId } from './auth-context.decorator';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AuthContext } from './auth-context.decorator';
import { HybridAuthGuard } from './hybrid-auth.guard';
import { SkipOrgCheck } from './skip-org-check.decorator';
import type { AuthContext as AuthContextType } from './types';

@ApiExcludeController()
@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
@UseGuards(HybridAuthGuard)
@ApiSecurity('apikey')
export class AuthController {
  @Get('me')
  @SkipOrgCheck()
  @ApiOperation({
    summary: 'Get current user info, organizations, and pending invitations',
  })
  async getMe(@AuthContext() authContext: AuthContextType) {
    const userId = authContext.userId;
    if (!userId) {
      return {
        user: null,
        organizations: [],
        pendingInvitation: null,
        hasInactiveMembership: false,
        authType: authContext.authType,
      };
    }

    const [user, memberships, pendingInvitation, inactiveMembershipCount] =
      await Promise.all([
        db.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
          },
        }),
        db.member.findMany({
          where: { userId, isActive: true, deactivated: false },
          select: {
            id: true,
            role: true,
            organizationId: true,
            organization: {
              select: {
                id: true,
                name: true,
                logo: true,
                onboardingCompleted: true,
                hasAccess: true,
                createdAt: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        db.invitation.findFirst({
          where: {
            email: authContext.userEmail ?? '',
            status: 'pending',
          },
          select: { id: true },
        }),
        // Count memberships that exist but are no longer active (deactivated
        // or removed). Lets the app tell a genuinely new user (no memberships
        // at all → onboarding) apart from an offboarded user whose access was
        // revoked (→ "access removed" instead of a spurious new org). CS-569.
        db.member.count({
          where: {
            userId,
            OR: [{ deactivated: true }, { isActive: false }],
          },
        }),
      ]);

    return {
      user,
      organizations: memberships.map((m) => ({
        ...m.organization,
        memberRole: m.role,
        memberId: m.id,
      })),
      pendingInvitation,
      hasInactiveMembership: inactiveMembershipCount > 0,
      authType: authContext.authType,
      ...(authContext.authType === 'gideon'
        ? { tenantId: authContext.organizationId }
        : {}),
    };
  }

  @Get('invitations')
  @UseGuards(PermissionGuard)
  @RequirePermission('member', 'read')
  @ApiOperation({ summary: 'List pending invitations for the organization' })
  async listInvitations(@OrganizationId() organizationId: string) {
    const invitations = await db.invitation.findMany({
      where: { organizationId, status: 'pending' },
      orderBy: { email: 'asc' },
    });

    return { data: invitations };
  }
}
