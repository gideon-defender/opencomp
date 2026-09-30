import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { db, TrustFramework } from '@db';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { APP_AWS_ORG_ASSETS_BUCKET, s3Client } from '../app/s3';
import { AttachmentsService } from '../attachments/attachments.service';
import { NdaPdfService } from './nda-pdf.service';
import { TrustGrantReadsService } from './trust-grant-reads.service';

/**
 * Compliance-certificate downloads (native + custom frameworks) for
 * trust-portal grants: fetch, watermark, re-upload, sign. Split from
 * TrustAccessService; token validation comes from TrustGrantReadsService.
 */
@Injectable()
export class TrustResourceDownloadService {
  constructor(
    private readonly attachmentsService: AttachmentsService,
    private readonly ndaPdfService: NdaPdfService,
    private readonly grantReads: TrustGrantReadsService,
  ) {}
  /**
   * Shared certificate-download pipeline for trust-portal resources (native
   * and custom frameworks): fetch the stored PDF from S3, watermark it for the
   * requesting grant, re-upload the watermarked copy, and return a signed URL.
   * The two callers differ only in the trustResource lookup and the doc/file
   * naming, which they pass in.
   */
  private async watermarkAndSignTrustResource(params: {
    s3Key: string;
    fileName: string;
    recipientName: string;
    recipientEmail: string;
    organizationId: string;
    organizationName: string;
    grantId: string;
    docId: string;
    downloadFileName: string;
  }): Promise<{ signedUrl: string; fileName: string; fileSize: number }> {
    if (!s3Client || !APP_AWS_ORG_ASSETS_BUCKET) {
      throw new InternalServerErrorException(
        'Organization assets bucket is not configured',
      );
    }

    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: APP_AWS_ORG_ASSETS_BUCKET,
        Key: params.s3Key,
      }),
    );
    if (!response.Body) {
      throw new InternalServerErrorException('No file data received from S3');
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const originalPdfBuffer = Buffer.concat(chunks);

    const watermarked = await this.ndaPdfService.watermarkExistingPdf(
      originalPdfBuffer,
      {
        organizationName: params.organizationName,
        name: params.recipientName,
        email: params.recipientEmail,
        docId: params.docId,
      },
    );

    const key = await this.attachmentsService.uploadToS3(
      watermarked,
      params.downloadFileName,
      'application/pdf',
      params.organizationId,
      'trust_compliance_downloads',
      params.grantId,
    );

    const downloadUrl =
      await this.attachmentsService.getPresignedDownloadUrl(key);

    return {
      signedUrl: downloadUrl,
      fileName: params.fileName,
      fileSize: watermarked.length,
    };
  }

  async getComplianceResourceUrlByAccessToken(
    token: string,
    framework: TrustFramework,
  ) {
    const grant = await this.grantReads.validateAccessToken(token);

    // Validate framework enum
    if (!Object.values(TrustFramework).includes(framework)) {
      throw new BadRequestException(`Invalid framework: ${framework}`);
    }

    if (!s3Client || !APP_AWS_ORG_ASSETS_BUCKET) {
      throw new InternalServerErrorException(
        'Organization assets bucket is not configured',
      );
    }

    const record = await db.trustResource.findUnique({
      where: {
        organizationId_framework: {
          organizationId: grant.accessRequest.organizationId,
          framework,
        },
      },
    });

    if (!record) {
      throw new NotFoundException(
        `No certificate uploaded for framework ${framework}`,
      );
    }

    // Check if framework is enabled in Trust record and auto-enable if not (for backward compatibility)
    const trustRecord = await db.trust.findUnique({
      where: { organizationId: grant.accessRequest.organizationId },
    });

    const frameworkFieldMap: Record<
      TrustFramework,
      | 'iso27001'
      | 'iso42001'
      | 'gdpr'
      | 'hipaa'
      | 'soc3'
      | 'soc2type1'
      | 'soc2type2'
      | 'pci_dss'
      | 'nen7510'
      | 'iso9001'
      | 'pipeda'
      | 'ccpa'
      | 'dora'
      | 'nis_2'
      | 'hitrust_csf'
      | 'nist_csf'
      | 'nist_800_53'
    > = {
      [TrustFramework.iso_27001]: 'iso27001',
      [TrustFramework.iso_42001]: 'iso42001',
      [TrustFramework.gdpr]: 'gdpr',
      [TrustFramework.hipaa]: 'hipaa',
      [TrustFramework.soc2_type1]: 'soc2type1',
      [TrustFramework.soc2_type2]: 'soc2type2',
      [TrustFramework.soc3]: 'soc3',
      [TrustFramework.pci_dss]: 'pci_dss',
      [TrustFramework.nen_7510]: 'nen7510',
      [TrustFramework.iso_9001]: 'iso9001',
      [TrustFramework.pipeda]: 'pipeda',
      [TrustFramework.ccpa]: 'ccpa',
      [TrustFramework.dora]: 'dora',
      [TrustFramework.nis_2]: 'nis_2',
      [TrustFramework.hitrust_csf]: 'hitrust_csf',
      [TrustFramework.nist_csf]: 'nist_csf',
      [TrustFramework.nist_800_53]: 'nist_800_53',
    };

    const enabledField = frameworkFieldMap[framework];
    if (trustRecord && !trustRecord[enabledField]) {
      // Auto-enable the framework for backward compatibility with old organizations
      await db.trust.update({
        where: { organizationId: grant.accessRequest.organizationId },
        data: {
          [enabledField]: true,
        },
      });
    }

    // Download → watermark → re-upload → signed URL (shared pipeline).
    return this.watermarkAndSignTrustResource({
      s3Key: record.s3Key,
      fileName: record.fileName,
      recipientName: grant.accessRequest.name,
      recipientEmail: grant.subjectEmail,
      organizationId: grant.accessRequest.organizationId,
      organizationName: grant.accessRequest.organization.name,
      grantId: `${grant.id}`,
      docId: `compliance-${grant.id}-${framework}-${Date.now()}`,
      downloadFileName: `compliance-${framework}-grant-${grant.id}-${Date.now()}.pdf`,
    });
  }

  /**
   * Gated download of a custom-framework certificate (token + NDA required).
   * Mirrors getComplianceResourceUrlByAccessToken but keyed by customFrameworkId.
   * No framework auto-enable: custom display visibility is governed separately by
   * TrustCustomFramework.enabled.
   */
  async getCustomComplianceResourceUrlByAccessToken(
    token: string,
    customFrameworkId: string,
  ) {
    const grant = await this.grantReads.validateAccessToken(token);

    if (!s3Client || !APP_AWS_ORG_ASSETS_BUCKET) {
      throw new InternalServerErrorException(
        'Organization assets bucket is not configured',
      );
    }

    const record = await db.trustResource.findUnique({
      where: {
        organizationId_customFrameworkId: {
          organizationId: grant.accessRequest.organizationId,
          customFrameworkId,
        },
      },
    });

    if (!record) {
      throw new NotFoundException(
        'No certificate uploaded for this custom framework',
      );
    }

    // Download → watermark → re-upload → signed URL (shared pipeline).
    return this.watermarkAndSignTrustResource({
      s3Key: record.s3Key,
      fileName: record.fileName,
      recipientName: grant.accessRequest.name,
      recipientEmail: grant.subjectEmail,
      organizationId: grant.accessRequest.organizationId,
      organizationName: grant.accessRequest.organization.name,
      grantId: `${grant.id}`,
      docId: `compliance-${grant.id}-custom-${customFrameworkId}-${Date.now()}`,
      downloadFileName: `compliance-custom-${customFrameworkId}-grant-${grant.id}-${Date.now()}.pdf`,
    });
  }
}
