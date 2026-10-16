import { ConflictException, NotFoundException } from '@nestjs/common';
import { db, type Prisma } from '@db';
import { parsePermissions } from '../auth/app-access';
import { countHoldersExact } from './role-holders';
import { hasCaseOnlyCollision } from './role-validation';
import { parseObligationsField } from './role-obligations';

export async function orgRoleNames(
  organizationId: string,
  client: Pick<Prisma.TransactionClient, 'organizationRole'> = db,
): Promise<string[]> {
  const rows = await client.organizationRole.findMany({
    where: { organizationId },
    select: { name: true },
  });
  return rows.map((row) => row.name);
}

/**
 * Fail if `candidate` collides exactly or by case-only with existing names.
 * Exact hits map to 409; case-only variants are rejected to prevent
 * `Lead` vs `lead` confusion (DB unique is case-sensitive).
 */
export function assertNoNameCollision(
  candidate: string,
  existingNames: string[],
  excludeName?: string,
): void {
  const others = excludeName
    ? existingNames.filter((name) => name !== excludeName)
    : existingNames;
  if (others.includes(candidate)) {
    throw new ConflictException(
      `Role "${candidate}" already exists in this organization`,
    );
  }
  if (hasCaseOnlyCollision(candidate, others)) {
    throw new ConflictException(
      `Role "${candidate}" differs only by case from an existing role — use the existing spelling`,
    );
  }
}

/** Restore a rename only while its permission snapshot still matches. */
export async function revertRenameOnCaseCollision({
  organizationId,
  roleId,
  expected,
  previous,
  client = db,
}: {
  organizationId: string;
  roleId: string;
  expected: { name: string; permissions: string; obligations: string };
  previous: { name: string; permissions: string; obligations: string };
  client?: Prisma.TransactionClient;
}): Promise<void> {
  const rows = await client.organizationRole.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });
  const name = expected.name;
  const lowered = name.toLowerCase();
  const clash = rows.some(
    (row) =>
      row.id !== roleId &&
      row.name !== name &&
      row.name.toLowerCase() === lowered,
  );
  if (!clash) {
    return;
  }
  try {
    await client.organizationRole.update({
      where: { id: roleId, organizationId, ...expected },
      data: {
        name: previous.name,
        permissions: previous.permissions,
        obligations: previous.obligations,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') {
      throw new ConflictException(
        'Role changed during this rename. Reload the role and resolve the name conflict.',
      );
    }
    // The previous name was ours an instant ago — only an anticipated second
    // concurrent rename (P2002) breaks the revert, and the 409 below still
    // reports failure. Anything else (connection loss, row gone) is not an
    // anticipated race: rethrow it instead of masking it as a 409.
    if ((error as { code?: string }).code !== 'P2002') {
      throw error;
    }
  }
  throw new ConflictException(
    `Role "${name}" differs only by case from an existing role — use the existing spelling`,
  );
}

export async function fetchCustomRole(
  organizationId: string,
  roleId: string,
  client: Prisma.TransactionClient = db,
) {
  const role = await client.organizationRole.findFirst({
    where: { id: roleId, organizationId },
  });
  if (!role) {
    throw new NotFoundException(`Role not found: ${roleId}`);
  }
  const memberCount = await countHoldersExact(
    organizationId,
    role.name,
    client,
  );
  return {
    id: role.id,
    name: role.name,
    permissions: parsePermissions(role.permissions),
    obligations: parseObligationsField(role.obligations),
    isBuiltIn: false,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
    _count: { members: memberCount },
  };
}
