import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TimelinesController } from './timelines.controller';
import { TimelinesService } from './timelines.service';
import { TimelinesLifecycleService } from './timelines-lifecycle.service';
import { TimelinesTemplatesService } from './timelines-templates.service';
import { TimelinesPhasesService } from './timelines-phases.service';

@Module({
  imports: [AuthModule],
  controllers: [TimelinesController],
  providers: [
    TimelinesService,
    TimelinesLifecycleService,
    TimelinesTemplatesService,
    TimelinesPhasesService,
  ],
  exports: [TimelinesService],
})
export class TimelinesModule {}
