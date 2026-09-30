import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuthModule } from '../auth/auth.module';
import { TrustEmailService } from './email.service';
import { NdaPdfService } from './nda-pdf.service';
import { PolicyPdfRendererService } from './policy-pdf-renderer.service';
import { TrustAccessRequestController } from './trust-access-request.controller';
import { TrustNdaPreviewController } from './trust-nda-preview.controller';
import { TrustAccessNdaController } from './trust-access-nda.controller';
import { TrustAccessGrantController } from './trust-access-grant.controller';
import { TrustPublicController } from './trust-public.controller';
import { TrustAccessService } from './trust-access.service';
import { TrustGrantReadsService } from './trust-grant-reads.service';
import { TrustGrantTokenService } from './trust-grant-token.service';
import { TrustDocumentDownloadService } from './trust-document-download.service';
import { TrustResourceDownloadService } from './trust-resource-download.service';
import { TrustPolicyDownloadService } from './trust-policy-download.service';
import { TrustPolicyFileDownloadService } from './trust-policy-file-download.service';
import { TrustNdaService } from './trust-nda.service';
import { TrustNdaPreviewService } from './trust-nda-preview.service';
import { TrustNdaSignService } from './trust-nda-sign.service';
import { TrustRequestIntakeService } from './trust-request-intake.service';
import { TrustRequestApprovalService } from './trust-request-approval.service';
import { TrustRequestModerationService } from './trust-request-moderation.service';
import { TrustRequestResendService } from './trust-request-resend.service';
import { TrustPublicService } from './trust-public.service';
import { TrustPublicCatalogService } from './trust-public-catalog.service';
import { TrustPortalController } from './trust-portal.controller';
import { TrustPortalService } from './trust-portal.service';
import { TrustCustomFrameworkService } from './trust-custom-framework.service';
import { TrustCustomFrameworkBadgeService } from './trust-custom-framework-badge.service';

@Module({
  imports: [AuthModule, AttachmentsModule],
  controllers: [
    TrustPortalController,
    TrustAccessRequestController,
    TrustNdaPreviewController,
    TrustAccessNdaController,
    TrustAccessGrantController,
    TrustPublicController,
  ],
  providers: [
    TrustPortalService,
    TrustCustomFrameworkService,
    TrustCustomFrameworkBadgeService,
    TrustAccessService,
    TrustGrantReadsService,
    TrustGrantTokenService,
    TrustDocumentDownloadService,
    TrustResourceDownloadService,
    TrustPolicyDownloadService,
    TrustPolicyFileDownloadService,
    TrustNdaService,
    TrustNdaPreviewService,
    TrustNdaSignService,
    TrustRequestIntakeService,
    TrustRequestApprovalService,
    TrustRequestModerationService,
    TrustRequestResendService,
    TrustPublicService,
    TrustPublicCatalogService,
    NdaPdfService,
    TrustEmailService,
    PolicyPdfRendererService,
  ],
  exports: [
    TrustPortalService,
    TrustCustomFrameworkService,
    TrustAccessService,
    TrustPublicService,
    TrustPublicCatalogService,
  ],
})
export class TrustPortalModule {}
