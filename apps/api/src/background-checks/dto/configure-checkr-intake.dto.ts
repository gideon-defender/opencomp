import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ConfigureCheckrIntakeDto {
  @ApiProperty({
    description:
      'Verified Checkr account belonging exclusively to this tenant.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  accountId!: string;

  @ApiProperty({
    description:
      'ID of this tenant’s encrypted secret containing its Checkr API key.',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  apiKeySecretId!: string;

  @ApiProperty({ enum: ['sandbox', 'production'] })
  @IsIn(['sandbox', 'production'])
  environment!: 'sandbox' | 'production';

  @ApiProperty({
    description: 'Checkr package slug for new screening attempts.',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  package!: string;

  @ApiPropertyOptional({
    description:
      'Checkr hierarchy node custom ID, when required by the account.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  node?: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}
