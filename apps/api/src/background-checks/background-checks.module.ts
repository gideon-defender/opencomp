import { Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { CandidateScreeningsController } from './candidate-screenings.controller';
import { CandidateScreeningsService } from './candidate-screenings.service';
import { CandidateScreeningDispatchService } from './candidate-screening-dispatch.service';
import { CheckrIntakeConfigService } from './checkr-intake-config.service';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { BackgroundCheckBillingController } from './background-check-billing.controller';
import { BackgroundCheckBillingService } from './background-check-billing.service';
import { BackgroundCheckCustomService } from './background-check-custom.service';
import { CheckrClient } from './checkr.client';
import { BackgroundCheckPaymentService } from './background-check-payment.service';
import {
  BackgroundChecksController,
  PeopleBackgroundChecksController,
} from './background-checks.controller';
import { BackgroundChecksService } from './background-checks.service';

@Module({
  imports: [AuthModule, AttachmentsModule, BillingModule, SecretsModule],
  controllers: [
    CandidateScreeningsController,
    BackgroundChecksController,
    PeopleBackgroundChecksController,
    BackgroundCheckBillingController,
  ],
  providers: [
    CandidateScreeningsService,
    CandidateScreeningDispatchService,
    CheckrIntakeConfigService,
    BackgroundChecksService,
    BackgroundCheckBillingService,
    BackgroundCheckCustomService,
    CheckrClient,
    BackgroundCheckPaymentService,
  ],
  exports: [BackgroundChecksService, BackgroundCheckBillingService],
})
export class BackgroundChecksModule {}
