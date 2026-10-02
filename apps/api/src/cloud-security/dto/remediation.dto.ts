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
  connectionId!: string;

  @ApiProperty({ description: 'Check result (finding) ID.' })
  @IsString()
  @MaxLength(256)
  checkResultId!: string;

  @ApiProperty({ description: 'Remediation key for the finding.' })
  @IsString()
  @MaxLength(256)
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
  connectionId!: string;

  @ApiProperty({ description: 'Check result (finding) ID.' })
  @IsString()
  @MaxLength(256)
  checkResultId!: string;

  @ApiProperty({ description: 'Remediation key for the finding.' })
  @IsString()
  @MaxLength(256)
  remediationKey!: string;

  @ApiPropertyOptional({
    description: 'Acknowledgment text for high-risk fixes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  acknowledgment?: string;
}

export class BatchFindingDto {
  @ApiProperty({ description: 'Finding ID.' })
  @IsString()
  @MaxLength(256)
  id!: string;

  @ApiProperty({ description: 'Finding key.' })
  @IsString()
  @MaxLength(256)
  key!: string;

  @ApiProperty({ description: 'Finding title (stored, rendered in UI).' })
  @IsString()
  @MaxLength(500)
  title!: string;
}

export class CreateBatchDto {
  @ApiProperty({ description: 'Integration connection ID.' })
  @IsString()
  @MaxLength(256)
  connectionId!: string;

  @ApiProperty({ description: 'Findings to fix in this batch.' })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchFindingDto)
  findings!: BatchFindingDto[];
}

export const BATCH_UPDATABLE_STATUSES = [
  'pending',
  'running',
  'completed',
  // Legacy alias written by the trigger task and the web cleanup path.
  // Prefer 'completed' for new callers; 'done' stays accepted so finished
  // batches can still be cleared.
  'done',
  'failed',
  'cancelled',
] as const;

export class UpdateBatchDto {
  @ApiPropertyOptional({ description: 'Trigger run ID once the task starts.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
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
