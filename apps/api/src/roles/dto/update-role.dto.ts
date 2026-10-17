import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateRoleDto {
  @ApiPropertyOptional({
    example: 'Compliance Lead',
    maxLength: 50,
    description:
      'New role name. Renaming orphans Gideon assignments until the IdP value is renamed to match.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z][a-zA-Z0-9 -]*$/)
  name?: string;

  @ApiPropertyOptional({
    example: { control: ['read'] },
    description: 'Replacement permission map. Same validation as create.',
  })
  @IsOptional()
  @IsObject()
  @IsNotEmpty()
  permissions?: Record<string, string[]>;

  @ApiPropertyOptional({
    example: { compliance: true },
    description: 'Replacement obligation flags.',
  })
  @IsOptional()
  @IsObject()
  obligations?: Record<string, boolean>;

  @ApiPropertyOptional({
    example: true,
    description:
      'Required true when renaming a role that members hold. Confirms the caller accepts that holders lose access until Gideon assignments are renamed.',
  })
  @IsOptional()
  @IsBoolean()
  confirmRename?: boolean;
}
