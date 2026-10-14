import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class StartCandidateScreeningDto {
  @ApiProperty({
    description:
      'Client operation UUID. Reuse it when retrying the same submission.',
    format: 'uuid',
    pattern:
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
  })
  @IsUUID('4')
  operationId!: string;

  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({
    description: 'ISO country code for the candidate’s work location.',
    example: 'US',
    pattern: '^[A-Z]{2}$',
  })
  @Matches(/^[A-Z]{2}$/)
  country!: string;

  @ApiPropertyOptional({
    description: 'Two-letter work state; required for US work locations.',
    example: 'CA',
    pattern: '^[A-Z]{2}$',
  })
  @ValidateIf(
    (input: StartCandidateScreeningDto) =>
      input.country === 'US' || input.state !== undefined,
  )
  @Matches(/^[A-Z]{2}$/)
  state?: string;

  @ApiPropertyOptional({
    description: 'Work city, used for location-specific disclosures.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}
