import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAccessRequestDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  company?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  jobTitle?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  purpose?: string;

  // Capped at 365 to match the admin approve dialog (7–365 days).
  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  requestedDurationDays?: number;
}

export class ApproveAccessRequestDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  durationDays?: number;
}

export class DenyAccessRequestDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}

export class RevokeGrantDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}

export enum AccessRequestStatusFilter {
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  DENIED = 'denied',
  CANCELED = 'canceled',
}

export class ListAccessRequestsDto {
  @ApiPropertyOptional({ enum: AccessRequestStatusFilter })
  @IsEnum(AccessRequestStatusFilter)
  @IsOptional()
  status?: AccessRequestStatusFilter;
}

export class ReclaimAccessDto {
  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
