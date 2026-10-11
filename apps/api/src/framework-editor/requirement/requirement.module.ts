import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { RequirementService } from './requirement.service';

@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [RequirementService],
  exports: [RequirementService],
})
export class RequirementModule {}
