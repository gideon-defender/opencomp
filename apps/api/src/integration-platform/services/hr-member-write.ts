import { db, type Prisma } from '@db';
import { getValidRoleNames } from '../../auth/app-access';
import { lockRoleAssignments } from '../../roles/role-assignment-lock';

type HrMemberWrite =
  | {
      organizationId: string;
      data: Prisma.MemberUncheckedCreateInput;
      memberId?: never;
    }
  | {
      organizationId: string;
      memberId: string;
      data: Prisma.MemberUncheckedUpdateInput;
    };

export async function writeHrMember(input: HrMemberWrite) {
  return db.$transaction(async (tx) => {
    await lockRoleAssignments({ tx, organizationId: input.organizationId });
    if (typeof input.data.role === 'string') {
      const valid = await getValidRoleNames(input.organizationId, tx);
      const roles = input.data.role.split(',').map((role) => role.trim());
      if (roles.some((role) => !valid.has(role))) {
        throw new Error('Role definition changed during HR sync; retry sync');
      }
    }
    if (input.memberId !== undefined) {
      return tx.member.update({
        where: { id: input.memberId, organizationId: input.organizationId },
        data: input.data,
      });
    }
    return tx.member.create({ data: input.data });
  });
}
