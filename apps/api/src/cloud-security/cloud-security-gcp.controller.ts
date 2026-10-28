import {
  Controller,
  Post,
  Param,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import {
  CloudSecurityService,
  ConcurrentVariableSaveError,
  ConnectionNotFoundError,
  type ConnectionVariableValue,
} from './cloud-security.service';
import { GCPSecurityService } from './providers/gcp-security.service';
import {
  readProjectIds,
  resolveGcpSetupContext,
  withGcpResolveActions,
} from './gcp-setup.helpers';
import { SelectGcpProjectsDto } from './dto/select-gcp-projects.dto';
import { SetupGcpDto } from './dto/setup-gcp.dto';
import { ResolveGcpSetupStepDto } from './dto/resolve-gcp-setup-step.dto';
import { ApiAuthErrors } from '../openapi/common-responses';

@ApiTags('CloudSecurity')
@Controller({ path: 'cloud-security', version: '1' })
export class CloudSecurityGcpController {
  constructor(
    private readonly cloudSecurityService: CloudSecurityService,
    private readonly gcpSecurityService: GCPSecurityService,
  ) {}

  @Post('detect-gcp-org/:connectionId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'read')
  @ApiOperation({ summary: 'Detect the GCP organization for a connection' })
  @ApiCreatedResponse({
    description:
      'Detect the GCP organization for a connection completed successfully',
  })
  @ApiAuthErrors()
  async detectGcpOrg(
    @Param('connectionId') connectionId: string,
    @OrganizationId() organizationId: string,
  ) {
    try {
      const connection = await this.cloudSecurityService.getConnectionForDetect(
        connectionId,
        organizationId,
      );

      const credentials = connection.credentials as Record<string, unknown>;
      const accessToken = credentials?.access_token as string;
      if (!accessToken) {
        throw new Error(
          'No access token found. Reconnect the GCP integration.',
        );
      }

      const rawOrgs =
        await this.gcpSecurityService.detectOrganizations(accessToken);

      // Fetch projects per org in parallel
      const orgsWithProjects = await Promise.all(
        rawOrgs.map(async (org) => {
          const projects = await this.gcpSecurityService.detectProjectsForOrg(
            accessToken,
            org.id,
          );
          return {
            id: org.id,
            displayName: org.displayName,
            projects: projects
              .map((p) => ({ id: p.id, name: p.name, number: p.number }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          };
        }),
      );

      const variables = (connection.variables ?? {}) as Record<string, unknown>;

      // If exactly 1 org found, auto-save it
      let selectedOrganizationId = variables.organization_id as
        string | undefined;
      if (rawOrgs.length === 1) {
        selectedOrganizationId = rawOrgs[0].id;
        await this.cloudSecurityService.saveConnectionVariable(
          connectionId,
          'organization_id',
          selectedOrganizationId,
          organizationId,
        );
      }

      // Return only explicitly selected projects — never auto-select.
      // The variables snapshot predates the save above, which only touches
      // organization_id, so project_ids is still accurate.
      const existingProjectIds = readProjectIds(variables);

      return {
        organizations: orgsWithProjects,
        selectedProjectIds: existingProjectIds,
        selectedOrganizationId,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to detect GCP organization';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('select-gcp-projects/:connectionId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({ summary: 'Select GCP projects for a connection' })
  @ApiCreatedResponse({
    description: 'Select GCP projects for a connection completed successfully',
  })
  @ApiBody({ type: SelectGcpProjectsDto })
  @ApiAuthErrors()
  async selectGcpProjects(
    @Param('connectionId') connectionId: string,
    @Body() body: SelectGcpProjectsDto,
    @OrganizationId() organizationId: string,
  ) {
    // One merged write — organization_id, project_ids, and project_names
    // either all land or none does. Sequential per-key saves could persist a
    // half-applied selection on failure (e.g. org pinned, projects stale).
    const entries: Record<string, ConnectionVariableValue> = {
      project_ids: body.projectIds,
    };
    if (body.gcpOrganizationId) {
      entries.organization_id = body.gcpOrganizationId;
    }
    if (body.projectNames) {
      entries.project_names = body.projectNames;
    }
    try {
      await this.cloudSecurityService.saveConnectionVariables(
        connectionId,
        entries,
        organizationId,
      );
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        throw new HttpException('Connection not found', HttpStatus.NOT_FOUND);
      }
      if (error instanceof ConcurrentVariableSaveError) {
        throw new HttpException(
          'The connection was modified while this request was in flight. Please retry.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
    return { projectIds: body.projectIds };
  }

  @Post('setup-gcp/:connectionId')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({ summary: 'Set up GCP for a connection' })
  @ApiCreatedResponse({
    description: 'Up GCP for a connection updated successfully',
  })
  @ApiBody({ type: SetupGcpDto })
  @ApiAuthErrors()
  async setupGcp(
    @Param('connectionId') connectionId: string,
    @Body() body: SetupGcpDto,
    @OrganizationId() organizationId: string,
  ) {
    try {
      const context = await resolveGcpSetupContext(
        this.cloudSecurityService,
        this.gcpSecurityService,
        connectionId,
        organizationId,
        body?.projectId,
      );

      const result = await this.gcpSecurityService.autoSetup({
        accessToken: context.accessToken,
        organizationId: context.organizationId ?? '',
        projectId: context.projectId,
      });

      return {
        ...result,
        steps: withGcpResolveActions(result.steps, connectionId),
        organizationId: context.organizationId,
        projectId: context.projectId,
        projects: context.projects,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'GCP setup failed';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('setup-gcp/:connectionId/resolve-step')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiOperation({ summary: 'Resolve a GCP setup step' })
  @ApiCreatedResponse({
    description: 'Resolve a GCP setup step completed successfully',
  })
  @ApiBody({ type: ResolveGcpSetupStepDto })
  @ApiAuthErrors()
  async resolveGcpSetupStep(
    @Param('connectionId') connectionId: string,
    @Body() body: ResolveGcpSetupStepDto,
    @OrganizationId() organizationId: string,
  ) {
    try {
      const context = await resolveGcpSetupContext(
        this.cloudSecurityService,
        this.gcpSecurityService,
        connectionId,
        organizationId,
      );
      const result = await this.gcpSecurityService.resolveSetupStep({
        stepId: body.stepId,
        accessToken: context.accessToken,
        organizationId: context.organizationId ?? '',
        projectId: context.projectId,
      });

      return {
        email: result.email,
        step: withGcpResolveActions([result.step], connectionId)[0],
        organizationId: context.organizationId,
        projectId: context.projectId,
        projects: context.projects,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to resolve setup step';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }
}
