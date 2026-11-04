import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import {
  GCP_SETUP_STEP_IDS,
  type GcpSetupStepId,
} from '../providers/gcp-security.service';

/**
 * Request body for `POST /v1/cloud-security/setup-gcp/:connectionId/resolve-step`.
 *
 * `GCP_SETUP_STEP_IDS` and the `GcpSetupStepId` union derive from the same
 * constant, so validation cannot drift from the steps the setup flow emits.
 */
export class ResolveGcpSetupStepDto {
  @ApiProperty({
    description:
      'Setup step to resolve — use the id from the failed step in the setup-gcp response.',
    enum: GCP_SETUP_STEP_IDS,
    example: 'enable_security_command_center_api',
  })
  @IsString()
  @IsIn(GCP_SETUP_STEP_IDS)
  stepId!: GcpSetupStepId;
}
