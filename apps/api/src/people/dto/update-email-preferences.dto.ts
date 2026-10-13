import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmptyObject,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class EmailPreferencesDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  policyNotifications: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  taskReminders: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  weeklyTaskDigest: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  unassignedItemsNotifications: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  taskMentions: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  taskAssignments: boolean;

  @ApiPropertyOptional({ example: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  findingNotifications?: boolean;
}

export class UpdateEmailPreferencesDto {
  @ApiProperty({ type: EmailPreferencesDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EmailPreferencesDto)
  preferences: EmailPreferencesDto;
}
