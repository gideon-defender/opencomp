import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { TaskTemplateService } from './task-template.service';

@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [TaskTemplateService],
  exports: [TaskTemplateService],
})
export class TaskTemplateModule {}
