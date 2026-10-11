import { BadRequestException } from '@nestjs/common';
import { db } from '@db';

/**
 * Validates that the given member exists in the organization and can be
 * assigned as assignee/approver. Authorization is org-scoped: every member
 * of the organization is a genuine participant (there is no cross-tenant
 * role), so only membership is checked.
 * No-op if assigneeId is null/undefined (unassignment).
 */
export async function validateAssigneeMembership(
  assigneeId: string | null | undefined,
  organizationId: string,
  roleLabel: 'assignee' | 'approver' = 'assignee',
): Promise<void> {
  if (!assigneeId) return;

  const member = await db.member.findFirst({
    where: { id: assigneeId, organizationId },
  });

  if (!member) {
    const msg =
      roleLabel === 'approver'
        ? 'Approver is not a member of this organization'
        : 'Assignee is not a member of this organization';
    throw new BadRequestException(msg);
  }
}

/**
 * Validates approver specifically (requires deactivated check as well, for submitForReview flows).
 * Returns the approver member for callers that need it (e.g. audit log).
 */
export async function validateApproverMembership(
  approverId: string,
  organizationId: string,
) {
  const approver = await db.member.findFirst({
    where: { id: approverId, organizationId, deactivated: false },
    include: { user: true },
  });

  if (!approver) {
    throw new BadRequestException('Approver not found or is deactivated');
  }

  return approver;
}
