import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Canonical `service:Action` shape. Client-supplied action lists are
 * rechecked against the denylist server-side, but malformed tokens are
 * rejected at the boundary so junk never reaches script generation.
 */
const ACTION_TOKEN_PATTERN = /^[A-Za-z0-9-]+:[A-Za-z0-9*]+$/;

export class PreviewRemediationDto {
  @ApiProperty({ description: 'Integration connection ID.' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, {
    message: 'connectionId must not contain line breaks.',
  })
  connectionId!: string;

  @ApiProperty({ description: 'Check result (finding) ID.' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, {
    message: 'checkResultId must not contain line breaks.',
  })
  checkResultId!: string;

  @ApiProperty({ description: 'Remediation key for the finding.' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, {
    message: 'remediationKey must not contain line breaks.',
  })
  remediationKey!: string;

  @ApiPropertyOptional({
    description:
      'Previously computed permission list for recheck mode. Display-only ' +
      'fallback when the server plan cache expired — grant scripts are only ' +
      'minted from backend-computed plans.',
    example: ['s3:PutBucketEncryption'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  @Matches(ACTION_TOKEN_PATTERN, {
    each: true,
    message: 'Each permission must look like service:Action.',
  })
  cachedPermissions?: string[];
}

export class ExecuteRemediationDto {
  @ApiProperty({ description: 'Integration connection ID.' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, {
    message: 'connectionId must not contain line breaks.',
  })
  connectionId!: string;

  @ApiProperty({ description: 'Check result (finding) ID.' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, {
    message: 'checkResultId must not contain line breaks.',
  })
  checkResultId!: string;

  @ApiProperty({ description: 'Remediation key for the finding.' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, {
    message: 'remediationKey must not contain line breaks.',
  })
  remediationKey!: string;

  @ApiPropertyOptional({
    description: 'Acknowledgment text for high-risk fixes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @Matches(/^[^\r\n]*$/, {
    message: 'acknowledgment must not contain line breaks.',
  })
  acknowledgment?: string;

  @ApiPropertyOptional({
    description:
      'Hash of the previewed plan being acknowledged (planHash from the preview response). Required for AWS, GCP, and Azure execute: execute refuses when it is missing or when the plan changed.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, {
    message: 'expectedPlanHash must not contain line breaks.',
  })
  expectedPlanHash?: string;
}

export class BatchFindingDto {
  @ApiProperty({ description: 'Finding ID.' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, { message: 'id must not contain line breaks.' })
  id!: string;

  @ApiProperty({ description: 'Finding key.' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, { message: 'key must not contain line breaks.' })
  key!: string;

  @ApiProperty({ description: 'Finding title (stored, rendered in UI).' })
  @IsString()
  @MaxLength(500)
  @Matches(/^[^\r\n]*$/, { message: 'title must not contain line breaks.' })
  title!: string;
}

export class CreateBatchDto {
  @ApiProperty({ description: 'Integration connection ID.' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, {
    message: 'connectionId must not contain line breaks.',
  })
  connectionId!: string;

  @ApiProperty({ description: 'Findings to fix in this batch.' })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchFindingDto)
  findings!: BatchFindingDto[];
}

import {
  ACTIVE_BATCH_STATUSES,
  TERMINAL_BATCH_STATUSES,
} from '../remediation-batch-status';

/**
 * Every status the update endpoint accepts: anything the batch can still
 * be in (active) or move to (terminal). Derived from the status module so
 * the accepted list cannot drift from the lifecycle sets or the partial
 * unique index predicate they mirror.
 */
export const BATCH_UPDATABLE_STATUSES = [
  ...ACTIVE_BATCH_STATUSES,
  ...TERMINAL_BATCH_STATUSES,
] as const;

export class UpdateBatchDto {
  @ApiPropertyOptional({ description: 'Trigger run ID once the task starts.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  @Matches(/^[^\r\n]*$/, {
    message: 'triggerRunId must not contain line breaks.',
  })
  triggerRunId?: string;

  @ApiPropertyOptional({
    description: 'Batch status.',
    enum: [...BATCH_UPDATABLE_STATUSES],
  })
  @IsOptional()
  @IsString()
  @IsIn([...BATCH_UPDATABLE_STATUSES])
  status?: string;
}
