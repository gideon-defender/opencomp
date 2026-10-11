import { Module } from '@nestjs/common';
import { FrameworkVersionsService } from './framework-versions.service';

@Module({
  controllers: [],
  providers: [FrameworkVersionsService],
  exports: [FrameworkVersionsService],
})
export class FrameworkVersionsModule {}
