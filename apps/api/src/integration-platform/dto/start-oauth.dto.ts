import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class StartOAuthDto {
  @ApiProperty({ description: 'OAuth provider slug', example: 'gcp' })
  @IsString()
  @IsNotEmpty()
  providerSlug!: string;

  @ApiPropertyOptional({ description: 'URL to return to after authorization' })
  @IsOptional()
  @IsString()
  redirectUrl?: string;

  @ApiPropertyOptional({ description: 'Existing connection to reauthorize' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  connectionId?: string;

  // Kept for existing clients. Authorization uses the authenticated org context.
  @ApiPropertyOptional({ description: 'Organization ID (legacy client field)' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}
