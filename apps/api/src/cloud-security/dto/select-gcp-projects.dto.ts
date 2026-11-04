import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';
import { IsStringRecord } from '../validators/is-string-record.validator';

/**
 * Request body for `POST /v1/cloud-security/select-gcp-projects/:connectionId`.
 * All fields land in one atomic variables write — there is no partial save.
 */
export class SelectGcpProjectsDto {
  @ApiProperty({
    description:
      'GCP project IDs to scan for this connection. Replaces the previous selection.',
    example: ['prj-payments-prod'],
    type: 'array',
    items: { type: 'string' },
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  projectIds!: string[];

  @ApiPropertyOptional({
    description:
      'Project display names keyed by project ID and project number; surfaced on findings.',
    example: {
      'prj-payments-prod': 'Payments Production',
      '123456789': 'Payments Production',
    },
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsStringRecord()
  projectNames?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'GCP organization resource ID (numeric) to scope the connection to.',
    example: '123456789012',
  })
  @IsOptional()
  @IsString()
  gcpOrganizationId?: string;
}
