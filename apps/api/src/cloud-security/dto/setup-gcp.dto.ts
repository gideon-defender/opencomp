import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Request body for `POST /v1/cloud-security/setup-gcp/:connectionId`.
 */
export class SetupGcpDto {
  @ApiPropertyOptional({
    description:
      'GCP project to enable the Security Command Center APIs on. ' +
      'Defaults to the first explicitly selected project for this connection.',
    example: 'prj-payments-prod',
  })
  @IsOptional()
  @IsString()
  projectId?: string;
}
