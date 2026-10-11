import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PolicyTemplateService } from './policy-template.service';

@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [PolicyTemplateService],
  exports: [PolicyTemplateService],
})
export class PolicyTemplateModule {}
