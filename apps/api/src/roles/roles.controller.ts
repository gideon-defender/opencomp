import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { OrganizationId } from '../auth/auth-context.decorator';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { RolesService } from './roles.service';
import { ApiAuthErrors, ApiForbiddenError } from '../openapi/common-responses';

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
    schema: {
      type: 'object',
      properties: {
        builtInRoles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              isBuiltIn: { type: 'boolean' },
              description: { type: 'string' },
            },
          },
        },
        customRoles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              permissions: { type: 'object' },
              isBuiltIn: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiForbiddenError()
  async listRoles(@OrganizationId() organizationId: string) {
    return this.rolesService.listRoles(organizationId);
  }

  @Get('permissions')
  @RequirePermission('app', 'read')
  @ApiOperation({
    summary: 'Resolve permissions for custom roles',
    description:
      'Returns the merged permissions for the given custom role names. Used by the frontend to resolve effective permissions for users with custom roles.',
  })
  @ApiResponse({
    status: 200,
    description: 'Merged permissions for the requested roles',
    schema: {
      type: 'object',
      properties: {
        permissions: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiForbiddenError()
  async getPermissionsForRoles(
    @OrganizationId() organizationId: string,
    @Query('roles') roles: string,
  ) {
    const roleNames = (roles || '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    const permissions = await this.rolesService.getPermissionsForRoles(
      organizationId,
      roleNames,
    );
    const obligations = await this.rolesService.getObligationsForRoles(
      organizationId,
      roleNames,
    );
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
    description: 'Effective obligations for the built-in role',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        obligations: {
          type: 'object',
          properties: { compliance: { type: 'boolean' } },
        },
      },
    },
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
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        permissions: { type: 'object' },
        isBuiltIn: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
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
}
