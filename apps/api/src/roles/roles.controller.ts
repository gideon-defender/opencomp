import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExtension,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthContext, OrganizationId } from '../auth/auth-context.decorator';
import type { AuthContext as AuthContextType } from '../auth/types';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { RolesService } from './roles.service';
import { toGrantCaller } from './role-grant';
import { ApiAuthErrors, ApiForbiddenError } from '../openapi/common-responses';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateBuiltInObligationsDto } from './dto/update-built-in-obligations.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import {
  listRolesSchema,
  obligationsSchema,
  permissionsSchema,
  roleDetailsSchema,
} from './roles-response.schemas';

const MAX_ROLES_QUERY = 100;

@ApiTags('Roles')
@Controller({ path: 'roles', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission('ac', 'read')
  @ApiOperation({
    summary: 'List all roles',
    description:
      'List all roles for the organization, including built-in and custom roles.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of roles',
    schema: listRolesSchema,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiForbiddenError()
  async listRoles(@OrganizationId() organizationId: string) {
    return this.rolesService.listRoles(organizationId);
  }

  @Get('permissions')
  @RequirePermission('app', 'read')
  @ApiOperation({
    summary: 'Resolve permissions for roles',
    description:
      'Returns the merged permissions for the given role names (built-in and custom). Used by the frontend to resolve effective permissions for users.',
  })
  // Declared explicitly: the handler accepts `string | string[] | undefined`
  // (repeated params are joined), which the Swagger plugin does not infer
  // into a parameter. Without this, the MCP tool loses its only input.
  @ApiQuery({
    name: 'roles',
    required: true,
    type: String,
    description:
      'Comma-separated role names (or repeated roles params), e.g. admin,Compliance Lead. Max 100 names.',
  })
  @ApiResponse({
    status: 200,
    description: 'Merged permissions',
    schema: permissionsSchema,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiForbiddenError()
  async getPermissionsForRoles(
    @OrganizationId() organizationId: string,
    @Query('roles') roles: string | string[] | undefined,
  ) {
    const raw = Array.isArray(roles) ? roles.join(',') : roles || '';
    if (raw.length > 5000) {
      throw new BadRequestException('Too many roles requested');
    }
    const roleNames = raw
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    if (roleNames.length > MAX_ROLES_QUERY) {
      throw new BadRequestException(
        `Too many roles requested (max ${MAX_ROLES_QUERY})`,
      );
    }
    const [permissions, obligations] = await Promise.all([
      this.rolesService.getPermissionsForRoles(organizationId, roleNames),
      this.rolesService.getObligationsForRoles(organizationId, roleNames),
    ]);
    return { permissions, obligations };
  }

  @Get('built-in/:name/obligations')
  @RequirePermission('ac', 'read')
  @ApiOperation({
    summary: 'Get obligations for a built-in role',
    description:
      'Returns the effective obligations for a built-in role (owner, admin, auditor, employee, contractor) — DB override if present, else the hardcoded default.',
  })
  @ApiParam({
    name: 'name',
    description: 'Built-in role name',
    example: 'owner',
  })
  @ApiResponse({
    status: 200,
    description: 'Effective obligations',
    schema: obligationsSchema,
  })
  @ApiAuthErrors()
  async getBuiltInObligations(
    @OrganizationId() organizationId: string,
    @Param('name') name: string,
  ) {
    const obligations = await this.rolesService.getBuiltInObligations(
      organizationId,
      name,
    );
    return { name, obligations };
  }

  @Patch('built-in/:name/obligations')
  @RequirePermission('ac', 'update')
  @ApiExtension('x-comp-mcp', { name: 'update-built-in-obligations' })
  @ApiOperation({
    summary: 'Set obligations for a built-in role',
    description:
      'Set the obligation override for a built-in role for this organization. Use to opt a built-in role into or out of compliance work.',
  })
  @ApiBody({ type: UpdateBuiltInObligationsDto })
  @ApiParam({
    name: 'name',
    description: 'Built-in role name',
    example: 'owner',
  })
  @ApiResponse({
    status: 200,
    description: 'Effective obligations',
    schema: obligationsSchema,
  })
  @ApiAuthErrors()
  @ApiForbiddenError()
  async setBuiltInObligations(
    @OrganizationId() organizationId: string,
    @Param('name') name: string,
    @Body() dto: UpdateBuiltInObligationsDto,
    @AuthContext() auth: AuthContextType,
  ) {
    return this.rolesService.setBuiltInObligations(
      organizationId,
      name,
      dto.obligations,
      toGrantCaller(auth),
    );
  }

  @Get(':roleId')
  @RequirePermission('ac', 'read')
  @ApiOperation({
    summary: 'Get a role by ID',
    description: 'Get details of a specific custom role.',
  })
  @ApiParam({ name: 'roleId', description: 'Role ID', example: 'rol_abc123' })
  @ApiResponse({
    status: 200,
    description: 'Role details',
    schema: roleDetailsSchema,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiForbiddenError()
  async getRole(
    @OrganizationId() organizationId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.rolesService.getRole(organizationId, roleId);
  }

  @Post()
  @RequirePermission('ac', 'create')
  @ApiExtension('x-comp-mcp', { name: 'create-role' })
  @ApiOperation({
    summary: 'Create a custom role',
    description:
      'Define a tenant-scoped custom role (permissions + obligations). Use when you need a reusable permission set for this organization. Does not assign anyone — assign users in Gideon.',
  })
  @ApiBody({ type: CreateRoleDto })
  @ApiResponse({ status: 201, description: 'Custom role created' })
  @ApiAuthErrors()
  @ApiForbiddenError()
  async createRole(
    @OrganizationId() organizationId: string,
    @Body() dto: CreateRoleDto,
    @AuthContext() auth: AuthContextType,
  ) {
    return this.rolesService.createRole(
      organizationId,
      dto,
      toGrantCaller(auth),
    );
  }

  @Patch(':roleId')
  @RequirePermission('ac', 'update')
  @ApiExtension('x-comp-mcp', { name: 'update-role' })
  @ApiOperation({
    summary: 'Update a custom role',
    description:
      'Update a tenant-scoped custom role definition. Use to change what the name can do. Does not change who holds it — manage assignments in Gideon.',
  })
  @ApiBody({ type: UpdateRoleDto })
  @ApiParam({ name: 'roleId', description: 'Role ID', example: 'rol_abc123' })
  @ApiResponse({ status: 200, description: 'Custom role updated' })
  @ApiAuthErrors()
  @ApiForbiddenError()
  async updateRole(
    @OrganizationId() organizationId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
    @AuthContext() auth: AuthContextType,
  ) {
    return this.rolesService.updateRole(
      organizationId,
      roleId,
      dto,
      toGrantCaller(auth),
    );
  }

  @Delete(':roleId')
  @RequirePermission('ac', 'delete')
  @ApiExtension('x-comp-mcp', { name: 'delete-role' })
  @ApiOperation({
    summary: 'Delete a custom role',
    description:
      'Delete an unassigned tenant-scoped custom role. Use to remove unused definitions. Blocked while members hold it — remove assignments in Gideon first.',
  })
  @ApiParam({ name: 'roleId', description: 'Role ID', example: 'rol_abc123' })
  @ApiResponse({ status: 200, description: 'Custom role deleted' })
  @ApiAuthErrors()
  @ApiForbiddenError()
  async deleteRole(
    @OrganizationId() organizationId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.rolesService.deleteRole(organizationId, roleId);
  }
}
