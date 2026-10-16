import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesReadService } from './roles-read.service';
import { RolesResolutionService } from './roles-resolution.service';
import { RolesUpdateService } from './roles-update.service';
import { RolesWriteService } from './roles-write.service';
import { RolesService } from './roles.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RolesController],
  providers: [
    RolesService,
    RolesReadService,
    RolesResolutionService,
    RolesUpdateService,
    RolesWriteService,
  ],
  exports: [
    RolesService,
    RolesReadService,
    RolesResolutionService,
    RolesUpdateService,
    RolesWriteService,
  ],
})
export class RolesModule {}
