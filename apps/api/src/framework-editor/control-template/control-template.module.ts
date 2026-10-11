import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ControlTemplateService } from './control-template.service';

@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [ControlTemplateService],
  exports: [ControlTemplateService],
})
export class ControlTemplateModule {}
