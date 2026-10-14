import { ApiProperty } from '@nestjs/swagger';

export class CandidateScreeningRunDto {
  @ApiProperty({
    description:
      'Screening attempt ID. Poll the tenant-scoped screening detail endpoint.',
    example: 'pcs_example',
  })
  runId!: string;

  @ApiProperty({
    enum: [
      'queued',
      'dispatching',
      'invited',
      'refunding',
      'failed',
      'needs_review',
    ],
  })
  status!: string;
}
