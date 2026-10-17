import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db, type Prisma } from '@db';
import { withRoleDefinitionLock } from './role-assignment-lock';
import type { UpdateRoleDto } from './dto/update-role.dto';
import { BUILT_IN_ROLE_NAMES, countHoldersExact } from './role-holders';
import {
  assertCallerMayGrantChecked,
  type RoleGrantCaller,
} from './role-grant';
import {
  parseObligationsField,
  withCompliancePortal,
} from './role-obligations';
import {
  assertNoNameCollision,
  fetchCustomRole,
  orgRoleNames,
  revertRenameOnCaseCollision,
} from './role-lookup';
import { parsePermissions } from '../auth/app-access';
import {
  validateRoleName,
  validateRoleObligations,
  validateRolePermissions,
} from './role-validation';

/**
 * Order-insensitive permission-map equality (for no-op update detection).
 * Both sides are sorted before comparison, so key order and action order
 * never trigger a write — but the multisets must match exactly. A naive
 * subset check would treat `{r: ["read", "read"]}` as equal to
 * `{r: ["read", "create"]}` and silently drop the revocation of `create`.
 */
function permissionsMapsEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => {
    const aActions = a[key];
    const bActions = b[key];
    if (!Array.isArray(bActions) || aActions.length !== bActions.length) {
      return false;
    }
    const sortedA = [...aActions].sort();
    const sortedB = [...bActions].sort();
    return sortedA.every((action, index) => action === sortedB[index]);
  });
}

@Injectable()
export class RolesUpdateService {
  async updateRole(
    organizationId: string,
    roleId: string,
    dto: UpdateRoleDto,
    caller?: RoleGrantCaller,
  ) {
    if (dto.name !== undefined) {
      return withRoleDefinitionLock({
        organizationId,
        work: (client) =>
          this.updateRoleChecked({
            organizationId,
            roleId,
            dto,
            caller,
            client,
          }),
      });
    }
    return this.updateRoleChecked({
      organizationId,
      roleId,
      dto,
      caller,
      client: db,
    });
  }

  private async updateRoleChecked({
    organizationId,
    roleId,
    dto,
    caller,
    client,
  }: {
    organizationId: string;
    roleId: string;
    dto: UpdateRoleDto;
    caller?: RoleGrantCaller;
    client: Prisma.TransactionClient;
  }) {
    const role = await client.organizationRole.findFirst({
      where: { id: roleId, organizationId },
    });
    if (!role) {
      throw new NotFoundException(`Role not found: ${roleId}`);
    }
    if (BUILT_IN_ROLE_NAMES.includes(role.name)) {
      throw new BadRequestException('Built-in roles cannot be edited');
    }

    const data: { name?: string; permissions?: string; obligations?: string } =
      {};
    let affectedMembers = 0;
    let previousName: string | undefined;
    let permissionsChanged = false;
    let obligationsChanged = false;

    if (dto.name !== undefined) {
      const next = validateRoleName(dto.name);
      if (next !== role.name) {
        const [existing, holders] = await Promise.all([
          orgRoleNames(organizationId, client),
          countHoldersExact(organizationId, role.name, client),
        ]);
        assertNoNameCollision(next, existing, role.name);
        affectedMembers = holders;
        if (affectedMembers > 0 && dto.confirmRename !== true) {
          throw new BadRequestException(
            `Renaming "${role.name}" affects ${affectedMembers} members — retry with confirmRename: true after removing or migrating Gideon assignments`,
          );
        }
        data.name = next;
        previousName = role.name;
      }
    }
    // A name can already exist in Member.role after an earlier rename.
    // Rebinding it grants permissions without an IdP assignment change.
    if (
      data.name !== undefined ||
      dto.permissions !== undefined ||
      dto.obligations !== undefined
    ) {
      const nextPermissions =
        dto.permissions !== undefined
          ? validateRolePermissions(dto.permissions)
          : parsePermissions(role.permissions);
      const nextObligations =
        dto.obligations !== undefined
          ? validateRoleObligations(dto.obligations)
          : parseObligationsField(role.obligations);
      const effective = withCompliancePortal(nextPermissions, nextObligations);
      await assertCallerMayGrantChecked({
        organizationId,
        requested: effective,
        caller,
        client,
      });
      const storedPermissions = parsePermissions(role.permissions);
      const storedObligations = parseObligationsField(role.obligations);
      if (dto.permissions !== undefined) {
        // Skip the write when the caller re-saves the current matrix: without
        // this, a no-op PUT triggers a holder recount plus a "Permissions
        // changed" warning for a change that never happened.
        if (!permissionsMapsEqual(effective, storedPermissions)) {
          data.permissions = JSON.stringify(effective);
          permissionsChanged = true;
        }
      } else if (dto.obligations !== undefined && nextObligations.compliance) {
        // Obligations-only opt-in must persist the implied portal set,
        // matching createRole. Opt-out never strips (portal can be held
        // independently — use an explicit permissions replacement).
        if (!permissionsMapsEqual(effective, storedPermissions)) {
          data.permissions = JSON.stringify(effective);
          permissionsChanged = true;
        }
      }
      if (dto.obligations !== undefined) {
        if (
          JSON.stringify(nextObligations) !== JSON.stringify(storedObligations)
        ) {
          data.obligations = JSON.stringify(nextObligations);
          obligationsChanged = true;
        }
      }
    }
    if (Object.keys(data).length === 0) {
      return {
        ...(await fetchCustomRole(organizationId, role.id, client)),
        affectedMembers,
      };
    }

    // Permission/obligation edits re-scope live holders — warn even when
    // the name did not change.
    if ((permissionsChanged || obligationsChanged) && affectedMembers === 0) {
      affectedMembers = await countHoldersExact(
        organizationId,
        role.name,
        client,
      );
    }

    try {
      await client.organizationRole.update({
        // Every retained field must still match the snapshot used by the
        // grant and compliance checks. A concurrent patch must retry them.
        where: {
          id: role.id,
          organizationId,
          name: role.name,
          permissions: role.permissions,
          obligations: role.obligations,
        },
        data,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2002') {
        throw new ConflictException(
          `Role "${data.name ?? role.name}" already exists in this organization`,
        );
      }
      if (code === 'P2025') {
        const current = await client.organizationRole.findFirst({
          where: { id: role.id, organizationId },
          select: { id: true },
        });
        if (current) {
          throw new ConflictException(
            'Role changed during this update. Reload the role and retry.',
          );
        }
        throw new NotFoundException(`Role not found: ${roleId}`);
      }
      throw error;
    }

    // A rename that passed the pre-check can still collide with a concurrent
    // case-variant rename (the DB unique is case-sensitive — P2002 only fires
    // on exact matches). Restore the snapshot only while it is still ours;
    // a later PATCH must keep its permission and obligation changes.
    if (data.name !== undefined && previousName !== undefined) {
      await revertRenameOnCaseCollision({
        organizationId,
        roleId: role.id,
        client,
        expected: {
          name: data.name,
          permissions: data.permissions ?? role.permissions,
          obligations: data.obligations ?? role.obligations,
        },
        previous: {
          name: previousName,
          permissions: role.permissions,
          obligations: role.obligations,
        },
      });
    }

    const updated = await fetchCustomRole(organizationId, role.id, client);
    if (affectedMembers > 0) {
      const warnings: string[] = [];
      if (previousName) {
        warnings.push(
          `Renaming orphans ${affectedMembers} members until Gideon assignments are renamed to match`,
        );
      }
      if (permissionsChanged) {
        warnings.push(
          `Permissions changed for ${affectedMembers} members — effective on their next request`,
        );
      } else if (obligationsChanged) {
        warnings.push(
          `Obligations changed for ${affectedMembers} members — effective on their next request`,
        );
      }
      return {
        ...updated,
        affectedMembers,
        ...(previousName
          ? { previousName, orphanedMembers: affectedMembers }
          : {}),
        warning: warnings.join(' '),
      };
    }
    return { ...updated, affectedMembers };
  }
}
