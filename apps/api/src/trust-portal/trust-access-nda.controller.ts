import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReclaimAccessDto } from './dto/trust-access.dto';
import { SignNdaDto } from './dto/nda.dto';
import { TrustAccessService } from './trust-access.service';
import { getRequestIp } from './trust-access-request.utils';
@ApiTags('Trust Access')
// Public portal routes send emails and mint tokens: hold them below the
// global limit so one client cannot spam org inboxes or enumerate grants.
@Throttle({ default: { ttl: 60000, limit: 60 } })
@Controller({ path: 'trust-access', version: '1' })
export class TrustAccessNdaController {
  constructor(private readonly trustAccessService: TrustAccessService) {}

  @Get('nda/:token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_getNda_v1',
    summary: 'Get NDA details by token',
    description: 'Fetch NDA agreement details for signing',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'NDA details returned',
  })
  async getNda(@Param('token') token: string) {
    return this.trustAccessService.getNdaByToken(token);
  }

  @Post('nda/:token/preview-nda')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_previewNdaByToken_v1',
    summary: 'Preview NDA by token',
    description: 'Generate preview NDA PDF for external user before signing',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Preview NDA generated',
  })
  async previewNdaByToken(@Param('token') token: string) {
    return this.trustAccessService.previewNdaByToken(token);
  }

  @Post('nda/:token/sign')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_signNda_v1',
    summary: 'Sign NDA',
    description:
      'Sign NDA agreement, generate watermarked PDF, and create access grant',
  })
  @ApiBody({ type: SignNdaDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'NDA signed successfully',
  })
  async signNda(
    @Param('token') token: string,
    @Body() dto: SignNdaDto,
    @Req() req: Request,
  ) {
    if (!dto.accept) {
      throw new BadRequestException('You must accept the NDA to proceed');
    }

    const ipAddress = getRequestIp(req);
    const userAgent =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : undefined;

    return this.trustAccessService.signNda(
      token,
      dto.name,
      dto.email,
      ipAddress,
      userAgent,
    );
  }

  @Post(':friendlyUrl/reclaim')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    operationId: 'TrustAccessController_reclaimAccess_v1',
    summary: 'Reclaim access',
    description:
      'Generate access link for users with existing grants to redownload data',
  })
  @ApiParam({
    name: 'friendlyUrl',
    description: 'Trust Portal friendly URL or Organization ID',
  })
  @ApiQuery({
    name: 'query',
    required: false,
    description:
      'Query parameter to append to the access link (e.g., security-questionnaire). Only slug-like values are kept; anything else is ignored.',
    example: 'security-questionnaire',
  })
  @ApiBody({ type: ReclaimAccessDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'Reclaim request accepted. An access link is emailed when an active grant exists.',
  })
  async reclaimAccess(
    // Note: friendlyUrl can be either the custom friendly URL or the organization ID
    @Param('friendlyUrl') friendlyUrl: string,
    @Body() dto: ReclaimAccessDto,
    @Query('query') query?: string,
  ) {
    return this.trustAccessService.reclaimAccess(friendlyUrl, dto.email, query);
  }

  @Get('access/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'TrustAccessController_getGrantByAccessToken_v1',
    summary: 'Get grant data by access token',
    description: 'Retrieve compliance data using access token',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Grant data returned',
  })
  async getGrantByAccessToken(@Param('token') token: string) {
    return this.trustAccessService.getGrantByAccessToken(token);
  }
}
