import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db, type Prisma } from '@db';
import { withRoleDefinitionLock } from './role-assignment-lock';
import { BUILT_IN_ROLE_PERMISSIONS, statement } from '@gideon-defender/auth';
import type { CreateRoleDto } from './dto/create-role.dto';
import {
  validateRoleName,
  validateRoleObligations,
  validateRolePermissions,
} from './role-validation';
import {
  assertCallerMayGrantChecked,
  type RoleGrantCaller,
} from './role-grant';
import {
  resolveEffectiveObligations,
  withCompliancePortal,
} from './role-obligations';
import {
  assertNoNameCollision,
  fetchCustomRole,
  orgRoleNames,
} from './role-lookup';
import { BUILT_IN_ROLE_NAMES, countHoldersExact } from './role-holders';

@Injectable()
export class RolesWriteService {
  async createRole(
    organizationId: string,
    dto: CreateRoleDto,
    caller?: RoleGrantCaller,
  ) {
    const name = validateRoleName(dto.name);
    const obligations = validateRoleObligations(dto.obligations);
    const permissions = withCompliancePortal(
      validateRolePermissions(dto.permissions),
      obligations,
    );
    return withRoleDefinitionLock({
      organizationId,
      work: async (client) => {
        const [existing] = await Promise.all([
          orgRoleNames(organizationId, client),
          assertCallerMayGrantChecked({
            organizationId,
            requested: permissions,
            caller,
            client,
          }),
        ]);
        assertNoNameCollision(name, existing);
        try {
          const created = await client.organizationRole.create({
            data: {
              name,
              permissions: JSON.stringify(permissions),
              obligations: JSON.stringify(obligations),
              organizationId,
            },
          });
          return await fetchCustomRole(organizationId, created.id, client);
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') {
            throw new ConflictException(
              `Role "${name}" already exists in this organization`,
            );
          }
          throw error;
        }
      },
    });
  }

  async setBuiltInObligations(
    organizationId: string,
    roleName: string,
    obligations: unknown,
    caller?: RoleGrantCaller,
  ) {
    if (!BUILT_IN_ROLE_NAMES.includes(roleName)) {
      throw new BadRequestException(`Not a built-in role: ${roleName}`);
    }
    const next = validateRoleObligations(obligations);
    const effective = resolveEffectiveObligations(roleName, next);
    if (effective.compliance) {
      // Opting a built-in into compliance gates compliance work. Require
      // the caller to hold portal access so `ac:update` alone cannot mint
      // compliance scope above itself.
      await assertCallerMayGrantChecked({
        organizationId,
        requested: { portal: [...statement.portal] },
        caller,
        message:
          'Cannot opt into compliance — the caller does not hold portal access',
      });
      const targetPortal = BUILT_IN_ROLE_PERMISSIONS[roleName]?.portal ?? [];
      if (!statement.portal.every((action) => targetPortal.includes(action))) {
        throw new BadRequestException(
          `Role "${roleName}" cannot require compliance because its fixed permissions lack portal access. Use a custom role with compliance enabled instead.`,
        );
      }
    } else if (!caller) {
      throw new ForbiddenException(
        'Caller context is required to grant permissions',
      );
    }
    try {
      await db.organizationRole.upsert({
        where: { organizationId_name: { organizationId, name: roleName } },
        create: {
          name: roleName,
          permissions: '{}',
          obligations: JSON.stringify(next),
          organizationId,
        },
        update: { obligations: JSON.stringify(next) },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `Role "${roleName}" already exists in this organization`,
        );
      }
      throw error;
    }
    return {
      name: roleName,
      obligations: effective,
    };
  }

  async deleteRole(organizationId: string, roleId: string) {
    return withRoleDefinitionLock({
      organizationId,
      work: (client) =>
        this.deleteRoleChecked({ organizationId, roleId, client }),
    });
  }

  private async deleteRoleChecked({
    organizationId,
    roleId,
    client,
  }: {
    organizationId: string;
    roleId: string;
    client: Prisma.TransactionClient;
  }) {
    const role = await client.organizationRole.findFirst({
      where: { id: roleId, organizationId },
    });
    if (!role) {
      throw new NotFoundException(`Role not found: ${roleId}`);
    }
    if (BUILT_IN_ROLE_NAMES.includes(role.name)) {
      throw new BadRequestException('Built-in roles cannot be deleted');
    }
    const holders = await countHoldersExact(organizationId, role.name, client);
    if (holders > 0) {
      throw new ConflictException(
        `Cannot delete role "${role.name}": ${holders} members currently hold it. Remove assignments in Gideon first (they clear at next login/reconciliation), then retry.`,
      );
    }
    try {
      await client.organizationRole.delete({
        where: {
          id: role.id,
          organizationId,
          name: role.name,
          permissions: role.permissions,
          obligations: role.obligations,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2025') {
        const current = await client.organizationRole.findFirst({
          where: { id: role.id, organizationId },
          select: { id: true },
        });
        if (current) {
          throw new ConflictException(
            'Role changed during this deletion. Reload the role and retry.',
          );
        }
        throw new NotFoundException(`Role not found: ${roleId}`);
      }
      throw error;
    }
    return { id: role.id, deleted: true };
  }
}
