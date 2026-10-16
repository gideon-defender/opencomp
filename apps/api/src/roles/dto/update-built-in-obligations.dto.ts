import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject } from 'class-validator';

export class UpdateBuiltInObligationsDto {
  @ApiProperty({
    example: { compliance: true },
    description:
      'Replacement obligation flags for the built-in role. Only known keys (compliance) allowed.',
  })
  @IsObject()
  @IsNotEmpty()
  obligations!: Record<string, boolean>;
}
