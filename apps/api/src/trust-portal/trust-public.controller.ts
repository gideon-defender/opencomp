import { Controller, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiNotFoundError } from '../openapi/common-responses';
import { TrustPublicService } from './trust-public.service';
import { TrustPublicCatalogService } from './trust-public-catalog.service';
@ApiTags('Trust Access')
// Public portal routes send emails and mint tokens: hold them below the
// global limit so one client cannot spam org inboxes or enumerate grants.
@Throttle({ default: { ttl: 60000, limit: 60 } })
@Controller({ path: 'trust-access', version: '1' })
export class TrustPublicController {
  constructor(
    private readonly trustPublicService: TrustPublicService,
    private readonly trustPublicCatalogService: TrustPublicCatalogService,
  ) {}

  @Get(':friendlyUrl/faqs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getFaqs_v1',
    summary: 'Get FAQs for a trust portal',
    description:
      'Retrieve the frequently asked questions for a published trust portal as structured data.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'FAQs retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        faqs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              question: { type: 'string' },
              answer: { type: 'string' },
              order: { type: 'number' },
            },
          },
          nullable: true,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Trust site not found or not published',
  })
  async getFaqs(@Param('friendlyUrl') friendlyUrl: string) {
    return this.trustPublicService.getFaqs(friendlyUrl);
  }

  @Get(':friendlyUrl/overview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicOverview_v1',
    summary: 'Get overview section for a trust portal',
    description:
      'Retrieve the overview/mission text for a published trust portal.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Overview retrieved successfully',
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicOverview(@Param('friendlyUrl') friendlyUrl: string) {
    return this.trustPublicService.getPublicOverview(friendlyUrl);
  }

  @Get(':friendlyUrl/security-questionnaire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicSecurityQuestionnaire_v1',
    summary: 'Get Security Questionnaire visibility for a trust portal',
    description:
      "Whether the org offers the AI-assisted Security Questionnaire on its public trust portal. Defaults to enabled when the portal can't be resolved.",
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Security Questionnaire visibility retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
      },
    },
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicSecurityQuestionnaire(
    @Param('friendlyUrl') friendlyUrl: string,
  ) {
    const enabled =
      await this.trustPublicService.getPublicSecurityQuestionnaireEnabled(
        friendlyUrl,
      );
    return { enabled };
  }

  @Get(':friendlyUrl/custom-links')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicCustomLinks_v1',
    summary: 'Get custom links for a trust portal',
    description:
      'Retrieve the custom external links configured for the trust portal.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Custom links retrieved successfully',
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicCustomLinks(@Param('friendlyUrl') friendlyUrl: string) {
    return this.trustPublicService.getPublicCustomLinks(friendlyUrl);
  }

  @Get(':friendlyUrl/favicon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicFavicon_v1',
    summary: 'Get favicon URL for a trust portal',
    description: 'Retrieve the favicon URL for the trust portal.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Favicon URL retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        faviconUrl: {
          type: 'string',
          nullable: true,
          description: 'Signed URL to the favicon, or null if not set',
        },
      },
    },
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicFavicon(@Param('friendlyUrl') friendlyUrl: string) {
    const faviconUrl =
      await this.trustPublicService.getPublicFavicon(friendlyUrl);
    return { faviconUrl };
  }

  @Get(':friendlyUrl/vendors')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicVendors_v1',
    summary: 'Get vendors/subprocessors for a trust portal',
    description:
      'Retrieve the list of vendors configured to display on the trust portal.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vendors retrieved successfully',
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicVendors(@Param('friendlyUrl') friendlyUrl: string) {
    return this.trustPublicCatalogService.getPublicVendors(friendlyUrl);
  }

  @Get(':friendlyUrl/custom-frameworks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicCustomFrameworks_v1',
    summary: 'Get org-authored custom frameworks shown on a trust portal',
    description:
      'Retrieve the list of custom frameworks the org has chosen to display on its public trust portal.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Custom frameworks retrieved successfully',
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicCustomFrameworks(@Param('friendlyUrl') friendlyUrl: string) {
    return this.trustPublicService.getPublicCustomFrameworks(friendlyUrl);
  }

  @Get(':friendlyUrl/profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicProfile_v1',
    summary: 'Get public trust portal header data',
    description:
      'Returns the org name, domain, branding, and contact for a published trust portal. Powers the public page hero.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Public portal profile retrieved successfully',
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicProfile(@Param('friendlyUrl') friendlyUrl: string) {
    return this.trustPublicService.getPublicProfile(friendlyUrl);
  }

  @Get(':friendlyUrl/frameworks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicFrameworks_v1',
    summary: 'Get enabled compliance frameworks for a trust portal',
    description:
      'Lists the native frameworks an org displays as compliant, with status and certificate presence. Powers the public compliance rail.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Enabled frameworks retrieved successfully',
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicFrameworks(@Param('friendlyUrl') friendlyUrl: string) {
    return this.trustPublicCatalogService.getPublicFrameworks(friendlyUrl);
  }

  @Get(':friendlyUrl/policies')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicPolicies_v1',
    summary: 'Get published policy names for a trust portal',
    description:
      'Lists published policy names for a trust portal. Names only — content stays behind the access-grant flow.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Published policies retrieved successfully',
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicPolicies(@Param('friendlyUrl') friendlyUrl: string) {
    return this.trustPublicService.getPublicPolicies(friendlyUrl);
  }

  @Get(':friendlyUrl/controls')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPublicControls_v1',
    summary: 'Get control names for a trust portal',
    description:
      'Lists non-archived control names for a trust portal. Powers the public Security Controls section.',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Controls retrieved successfully',
  })
  @ApiNotFoundError('Trust portal not found')
  async getPublicControls(@Param('friendlyUrl') friendlyUrl: string) {
    return this.trustPublicService.getPublicControls(friendlyUrl);
  }
}
