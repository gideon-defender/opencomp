import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FrameworkExportService } from './framework-export.service';
import { FrameworkEditorFrameworkService } from './framework.service';

@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [FrameworkEditorFrameworkService, FrameworkExportService],
  exports: [FrameworkEditorFrameworkService],
})
export class FrameworkEditorFrameworkModule {}
