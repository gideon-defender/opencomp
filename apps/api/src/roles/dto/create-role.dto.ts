import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({
    example: 'Compliance Lead',
    maxLength: 50,
    description:
      'Custom role name (2-50 chars, starts with a letter). Case-sensitive exact — must match Gideon entitlement values verbatim.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z][a-zA-Z0-9 -]*$/)
  name!: string;

  @ApiProperty({
    example: { control: ['read'], evidence: ['read', 'update'] },
    description:
      'Permission map by resource. Must grant at least one valid action.',
  })
  @IsObject()
  @IsNotEmpty()
  permissions!: Record<string, string[]>;

  @ApiPropertyOptional({
    example: { compliance: true },
    description: 'Obligation flags. Only known keys (compliance) allowed.',
  })
  @IsOptional()
  @IsObject()
  obligations?: Record<string, boolean>;
}
