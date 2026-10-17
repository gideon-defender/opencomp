import { Injectable } from '@nestjs/common';
import type { RoleObligations } from '@gideon-defender/auth';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';
import { RolesReadService } from './roles-read.service';
import { RolesResolutionService } from './roles-resolution.service';
import { RolesUpdateService } from './roles-update.service';
import { RolesWriteService } from './roles-write.service';
import type { RoleGrantCaller } from './role-grant';

export type { RoleGrantCaller };

/**
 * Facade preserving the historical `RolesService` API.
 *
 * Read, resolution, update, and write logic live in focused services (each
 * under the 300-line rule). New code should inject the focused service it
 * needs; `RolesModule` provides all five.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly read: RolesReadService,
    private readonly resolution: RolesResolutionService,
    private readonly update: RolesUpdateService,
    private readonly write: RolesWriteService,
  ) {}

  /**
   * Resolve combined permissions for a set of role names (built-in + custom).
   */
  async resolvePermissions(
    organizationId: string,
    roleNames: string[],
  ): Promise<Record<string, string[]>> {
    return this.read.resolvePermissions(organizationId, roleNames);
  }

  /**
   * List all roles for an organization (built-in + custom)
   */
  async listRoles(organizationId: string) {
    return this.read.listRoles(organizationId);
  }

  /**
   * Get a single role by ID
   */
  async getRole(organizationId: string, roleId: string) {
    return this.read.getRole(organizationId, roleId);
  }

  /**
   * Get merged permissions for a list of role names (built-in + custom).
   * Used by the frontend to resolve effective permissions for users.
   */
  async getPermissionsForRoles(
    organizationId: string,
    roleNames: string[],
  ): Promise<Record<string, string[]>> {
    return this.resolution.getPermissionsForRoles(organizationId, roleNames);
  }

  /**
   * Filter a list of members down to those whose combined role permissions
   * grant the given `resource:action`.
   */
  async filterMembersWithPermission<M extends { role: string | null }>(
    organizationId: string,
    members: M[],
    resource: string,
    action: string,
  ): Promise<M[]> {
    return this.resolution.filterMembersWithPermission(
      organizationId,
      members,
      resource,
      action,
    );
  }

  /**
   * Get merged obligations for a list of role names (custom + built-in).
   */
  async getObligationsForRoles(
    organizationId: string,
    roleNames: string[],
  ): Promise<RoleObligations> {
    return this.resolution.getObligationsForRoles(organizationId, roleNames);
  }

  /**
   * Set the obligation override for a built-in role for this organization.
   * Creates the override row when absent, updates it when present.
   */
  async setBuiltInObligations(
    organizationId: string,
    roleName: string,
    obligations: unknown,
    caller?: RoleGrantCaller,
  ) {
    return this.write.setBuiltInObligations(
      organizationId,
      roleName,
      obligations,
      caller,
    );
  }

  /**
   * Read the obligations for a single built-in role for this organization —
   * DB override if present, else the hardcoded default.
   */
  async getBuiltInObligations(
    organizationId: string,
    roleName: string,
  ): Promise<RoleObligations> {
    return this.resolution.getBuiltInObligations(organizationId, roleName);
  }

  /**
   * Create a tenant-scoped custom role definition. Does not assign anyone —
   * assignments live in Gideon and sync via login + reconciliation.
   */
  async createRole(
    organizationId: string,
    dto: CreateRoleDto,
    caller?: RoleGrantCaller,
  ) {
    return this.write.createRole(organizationId, dto, caller);
  }

  /**
   * Update a custom role definition. Never touches `Member.role` — the
   * meaning of an assigned name changes, not who holds it. Renaming with
   * holders returns `affectedMembers` + `warning` so the UI confirms.
   */
  async updateRole(
    organizationId: string,
    roleId: string,
    dto: UpdateRoleDto,
    caller?: RoleGrantCaller,
  ) {
    return this.update.updateRole(organizationId, roleId, dto, caller);
  }

  /**
   * Delete a custom role. Blocked while members hold it (409) — remove
   * assignments in Gideon first (they clear at next login/reconciliation).
   */
  async deleteRole(organizationId: string, roleId: string) {
    return this.write.deleteRole(organizationId, roleId);
  }
}
