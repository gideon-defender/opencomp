import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationController } from './organization.controller';
import { OrganizationCleanupService } from './organization-cleanup.service';
import { OrganizationS3CleanupService } from './organization-s3-cleanup';
import { OrganizationVectorCleanupService } from './organization-vector-cleanup';
import { OrganizationService } from './organization.service';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationController],
  providers: [
    OrganizationS3CleanupService,
    OrganizationVectorCleanupService,
    OrganizationCleanupService,
    OrganizationService,
  ],
  exports: [OrganizationService],
})
export class OrganizationModule {}
