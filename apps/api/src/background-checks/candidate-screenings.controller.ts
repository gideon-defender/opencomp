import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiExtension,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { OrganizationId } from '../auth/auth-context.decorator';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CandidateScreeningsService } from './candidate-screenings.service';
import { CheckrIntakeConfigService } from './checkr-intake-config.service';
import { ConfigureCheckrIntakeDto } from './dto/configure-checkr-intake.dto';
import { StartCandidateScreeningDto } from './dto/start-candidate-screening.dto';
import { CandidateScreeningRunDto } from './dto/candidate-screening-run.dto';

@ApiTags('Candidate Screenings')
@ApiSecurity('apikey')
@UseGuards(HybridAuthGuard, PermissionGuard)
@Controller({ path: 'people/candidate-screenings', version: '1' })
export class CandidateScreeningsController {
  constructor(
    private readonly screenings: CandidateScreeningsService,
    private readonly config: CheckrIntakeConfigService,
  ) {}

  @Get('readiness')
  @RequirePermission('backgroundCheck', 'create')
  @ApiExtension('x-comp-mcp', { name: 'check-candidate-screening-readiness' })
  @ApiOperation({
    summary: 'Check candidate intake readiness',
    description:
      'Checks this tenant’s enabled Checkr account and credentials before starting candidate screening. Returns safe readiness information only.',
  })
  readiness(@OrganizationId() organizationId: string) {
    return this.config.readiness(organizationId);
  }

  @Get('connection/readiness')
  @RequirePermission('integration', 'update')
  @ApiExtension('x-comp-mcp', { name: 'check-checkr-connection-readiness' })
  @ApiOperation({
    summary: 'Check Checkr connection health',
    description:
      'Checks this tenant’s Checkr account and credentials for integration editors. Use after configuration to verify intake readiness without screening permission. Returns no credentials or candidate data.',
  })
  connectionReadiness(@OrganizationId() organizationId: string) {
    return this.config.readiness(organizationId);
  }

  @Get()
  @RequirePermission('backgroundCheck', 'read')
  @ApiExtension('x-comp-mcp', { name: 'list-candidate-screenings' })
  @ApiOperation({
    summary: 'List candidate screening attempts',
    description:
      'Lists the latest 100 screening attempts for this tenant. Use to follow queued dispatches and Checkr invitation delivery; this does not report IdP provisioning or grant access.',
  })
  list(@OrganizationId() organizationId: string) {
    return this.screenings.list(organizationId);
  }

  @Get(':id')
  @RequirePermission('backgroundCheck', 'read')
  @ApiExtension('x-comp-mcp', { name: 'get-candidate-screening' })
  @ApiOperation({
    summary: 'Get candidate screening dispatch status',
    description:
      'Returns a tenant-scoped screening attempt by runId. Use to follow queued dispatch and hosted invitation delivery. Completion and identity provisioning are IdP-owned.',
  })
  get(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.screenings.get({ organizationId, id });
  }

  @Post()
  @HttpCode(202)
  @RequirePermission('backgroundCheck', 'create')
  @ApiExtension('x-comp-mcp', { name: 'start-candidate-screening' })
  @ApiBody({ type: StartCandidateScreeningDto })
  @ApiAcceptedResponse({ type: CandidateScreeningRunDto })
  @ApiOperation({
    summary: 'Start a candidate background check',
    description:
      'Queues a Checkr-hosted invitation without creating an account or granting access. Reuse operationId for retries. Poll GET /v1/people/candidate-screenings/{runId} for dispatch status.',
  })
  start(
    @OrganizationId() organizationId: string,
    @Body() input: StartCandidateScreeningDto,
  ) {
    return this.screenings.start({ organizationId, input });
  }

  @Put('connection')
  @RequirePermission('integration', 'update')
  @ApiExtension('x-comp-mcp', { name: 'configure-checkr-candidate-intake' })
  @ApiBody({ type: ConfigureCheckrIntakeDto })
  @ApiOperation({
    summary: 'Configure tenant Checkr intake',
    description:
      'Verifies and enables this tenant’s exclusive Checkr account using an encrypted tenant secret. Cannot replace an existing account. Never returns credentials or changes IdP access.',
  })
  configure(
    @OrganizationId() organizationId: string,
    @Body() input: ConfigureCheckrIntakeDto,
  ) {
    return this.config.configure({ organizationId, input });
  }
}
