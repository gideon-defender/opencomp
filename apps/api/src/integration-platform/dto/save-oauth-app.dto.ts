import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import type { Prisma } from '@db';

export class SaveOAuthAppDto {
  @ApiProperty({ description: 'Integration provider slug.', example: 'azure' })
  @IsString()
  providerSlug!: string;

  @ApiProperty({ description: 'OAuth application client ID.' })
  @IsString()
  clientId!: string;

  @ApiProperty({ description: 'OAuth application client secret.' })
  @IsString()
  clientSecret!: string;

  @ApiPropertyOptional({
    description: 'Override the default OAuth scopes.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customScopes?: string[];

  @ApiPropertyOptional({
    description:
      'Provider settings. For Azure, tenantId selects the directory UUID; omit it to use organizations.',
    type: 'object',
    additionalProperties: true,
    example: { tenantId: '55639f13-71b7-432d-b4e7-4efda934446d' },
  })
  @IsOptional()
  @IsObject()
  customSettings?: Prisma.InputJsonObject;
}
