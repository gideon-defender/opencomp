import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { OrganizationId } from '../auth/auth-context.decorator';
import { Throttle } from '@nestjs/throttler';
import { TrustFramework } from '@db';
import { TrustAccessService } from './trust-access.service';
@ApiTags('Trust Access')
// Public portal routes send emails and mint tokens: hold them below the
// global limit so one client cannot spam org inboxes or enumerate grants.
@Throttle({ default: { ttl: 60000, limit: 60 } })
@Controller({ path: 'trust-access', version: '1' })
export class TrustAccessGrantController {
  constructor(private readonly trustAccessService: TrustAccessService) {}

  @Get('access/:token/policies')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getPoliciesByAccessToken_v1',
    summary: 'List policies by access token',
    description: 'Get list of published policies available for download',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Policies list returned',
  })
  async getPoliciesByAccessToken(@Param('token') token: string) {
    return this.trustAccessService.getPoliciesByAccessToken(token);
  }

  @Get('access/:token/policies/download-all')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_downloadAllPolicies_v1',
    summary: 'Download all policies as watermarked PDF',
    description:
      'Generate combined PDF from all published policy content with watermark',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Download URL for watermarked PDF returned',
  })
  async downloadAllPolicies(@Param('token') token: string) {
    return this.trustAccessService.downloadAllPoliciesByAccessToken(token);
  }

  @Get('access/:token/policies/:policyId/download')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_downloadPolicy_v1',
    summary: 'Download single policy as watermarked PDF',
    description:
      'Generate watermarked PDF for a specific published policy and return a signed download URL',
  })
  @ApiParam({
    name: 'policyId',
    description: 'Policy ID',
    example: 'pol_abc123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signed URL for watermarked PDF returned',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Policy not found',
  })
  async downloadPolicy(
    @Param('token') token: string,
    @Param('policyId') policyId: string,
  ) {
    return this.trustAccessService.downloadPolicyByAccessToken(token, policyId);
  }

  @Get('access/:token/policies/download-all-zip')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_downloadAllPoliciesAsZip_v1',
    summary: 'Download all policies as ZIP with individual PDFs',
    description:
      'Generate ZIP archive containing individual watermarked PDFs for each policy',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Download URL for ZIP archive returned',
  })
  async downloadAllPoliciesAsZip(@Param('token') token: string) {
    return this.trustAccessService.downloadAllPoliciesAsZipByAccessToken(token);
  }

  @Get('access/:token/compliance-resources')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getComplianceResourcesByAccessToken_v1',
    summary: 'List compliance resources by access token',
    description:
      'Get list of uploaded compliance certificates for the organization',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Compliance resources list returned',
  })
  async getComplianceResourcesByAccessToken(@Param('token') token: string) {
    return this.trustAccessService.getComplianceResourcesByAccessToken(token);
  }

  @Get('access/:token/documents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getTrustDocumentsByAccessToken_v1',
    summary: 'List additional documents by access token',
    description:
      'Get list of trust portal additional documents available for download',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Documents list returned',
  })
  async getTrustDocumentsByAccessToken(@Param('token') token: string) {
    return this.trustAccessService.getTrustDocumentsByAccessToken(token);
  }

  @Get('access/:token/documents/download-all')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_downloadAllTrustDocuments_v1',
    summary: 'Download all additional documents as a ZIP by access token',
    description:
      'Creates a ZIP archive of all active trust portal additional documents and returns a signed download URL',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signed URL for ZIP archive returned',
  })
  async downloadAllTrustDocuments(@Param('token') token: string) {
    return this.trustAccessService.downloadAllTrustDocumentsByAccessToken(
      token,
    );
  }

  @Get('access/:token/documents/:documentId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_getTrustDocumentUrlByAccessToken_v1',
    summary: 'Download additional document by access token',
    description:
      'Get signed URL to download a specific trust portal additional document',
  })
  @ApiParam({
    name: 'documentId',
    description: 'Trust document ID',
    example: 'tdoc_abc123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signed URL for document returned',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Document not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid access token',
  })
  async getTrustDocumentUrlByAccessToken(
    @Param('token') token: string,
    @Param('documentId') documentId: string,
  ) {
    return this.trustAccessService.getTrustDocumentUrlByAccessToken(
      token,
      documentId,
    );
  }

  @Get('access/:token/compliance-resources/custom/:customFrameworkId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId:
      'TrustAccessController_getCustomComplianceResourceUrlByAccessToken_v1',
    summary:
      'Download a custom-framework compliance certificate by access token',
    description:
      'Get a signed URL to download a specific custom-framework certificate file',
  })
  @ApiParam({
    name: 'customFrameworkId',
    description: 'Org-authored custom framework ID',
    example: 'cfrm_abc123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signed URL for the custom-framework certificate returned',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Certificate not found',
  })
  async getCustomComplianceResourceUrlByAccessToken(
    @Param('token') token: string,
    @Param('customFrameworkId') customFrameworkId: string,
  ) {
    return this.trustAccessService.getCustomComplianceResourceUrlByAccessToken(
      token,
      customFrameworkId,
    );
  }

  @Get('access/:token/compliance-resources/:framework')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId:
      'TrustAccessController_getComplianceResourceUrlByAccessToken_v1',
    summary: 'Download compliance resource by access token',
    description:
      'Get signed URL to download a specific compliance certificate file',
  })
  @ApiParam({
    name: 'framework',
    enum: Object.values(TrustFramework),
    description: 'Compliance framework identifier',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signed URL for compliance resource returned',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Compliance resource not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid framework or access token',
  })
  async getComplianceResourceUrlByAccessToken(
    @Param('token') token: string,
    @Param('framework') framework: string,
  ) {
    return this.trustAccessService.getComplianceResourceUrlByAccessToken(
      token,
      framework as TrustFramework,
    );
  }

  @Post('admin/grants/:id/resend-access-email')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('trust', 'update')
  @ApiSecurity('apikey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_resendAccessEmail_v1',
    summary: 'Resend access granted email',
    description: 'Resend the access granted email to user with active grant',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Access email resent',
  })
  async resendAccessEmail(
    @OrganizationId() organizationId: string,
    @Param('id') grantId: string,
  ) {
    return this.trustAccessService.resendAccessGrantEmail(
      organizationId,
      grantId,
    );
  }
}
