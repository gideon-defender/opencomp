import { ForbiddenException, Logger } from '@nestjs/common';
import { db } from '@db';
import { hasAppAccess, stripControlChars } from './app-access';
import type { AuthenticatedRequest } from './types';

export async function populateLegacyMcpRequest({
  request,
  userId,
  logger,
}: {
  request: AuthenticatedRequest;
  userId: string;
  logger: Logger;
}): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    return false;
  }

  request.userId = user.id;
  request.userEmail = user.email;
  request.userRoles = null;
  request.organizationId = '';
  request.authType = 'session';
  request.isApiKey = false;
  request.isServiceToken = false;
  request.isMcpOAuth = true;

  // An MCP token is only usable by a member of at least one organization.
  // Enumerate active memberships up front (device-agent style) so a user with
  // none — e.g. someone who completed Google sign-in but was never invited to
  // any org, or who was removed from all of them — is blocked from EVERY MCP
  // tool, including the org-agnostic (skipOrgCheck) ones.
  const memberships = await db.member.findMany({
    where: { userId, deactivated: false, idpAccessRevoked: false },
    select: { id: true, role: true, department: true, organizationId: true },
  });

  if (memberships.length === 0) {
    // Authenticated, but a member of nothing — not an auth failure, so 403
    // (not 401) keeps the MCP client from looping on re-authentication.
    throw new ForbiddenException(
      'This account is not a member of any organization, so it cannot use the MCP.',
    );
  }

  // A saved selection also constrains single-membership users after a split.
  const binding = await db.mcpOrgBinding.findUnique({
    where: { userId },
    select: { organizationId: true },
  });
  const member = binding
    ? memberships.find((m) => m.organizationId === binding.organizationId)
    : memberships.length === 1
      ? memberships[0]
      : undefined;
  if (!member) {
    throw new ForbiddenException(
      'Choose an organization you still belong to for AI/MCP access in OpenComp settings, then try again.',
    );
  }

  // App-access gate: MCP follows the same rule as the web app — only roles
  // that grant app access (`app:read`) may use it. Portal-only roles
  // (employee/contractor, or custom roles without app access) are rejected.
  if (!(await hasAppAccess(member.organizationId, member.role))) {
    throw new ForbiddenException(
      "Your role doesn't have access to the app, so it can't use the MCP. " +
        'Ask an organization admin for access.',
    );
  }

  request.organizationId = member.organizationId;
  request.memberId = member.id;
  request.memberDepartment = member.department;
  request.userRoles = member.role ? member.role.split(',') : null;

  logger.log(
    `MCP OAuth token (legacy) authenticated for user ${stripControlChars(user.id)} (org ${stripControlChars(member.organizationId)})`,
  );
  return true;
}
