import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { withErrorCode } from '../common/i18n/error-messages';
import { toSafeFilename } from './trust-access-helpers';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { APP_AWS_ORG_ASSETS_BUCKET, s3Client, getSignedUrl } from '../app/s3';
import { AttachmentsService } from '../attachments/attachments.service';
import { PolicyPdfRendererService } from './policy-pdf-renderer.service';
import { NdaPdfService } from './nda-pdf.service';
import { TrustGrantReadsService } from './trust-grant-reads.service';

/** Single-policy PDF and policies-ZIP downloads for trust-portal grants. */
@Injectable()
export class TrustPolicyFileDownloadService {
  constructor(
    private readonly attachmentsService: AttachmentsService,
    private readonly pdfRendererService: PolicyPdfRendererService,
    private readonly ndaPdfService: NdaPdfService,
    private readonly grantReads: TrustGrantReadsService,
  ) {}
  async downloadPolicyByAccessToken(token: string, policyId: string) {
    const grant = await this.grantReads.validateAccessToken(token);

    const policy = await db.policy.findFirst({
      where: {
        id: policyId,
        organizationId: grant.accessRequest.organizationId,
        status: 'published',
        isArchived: false,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        content: true,
        pdfUrl: true,
        currentVersion: {
          select: {
            content: true,
            pdfUrl: true,
          },
        },
      },
    });

    if (!policy) {
      throw withErrorCode(
        new NotFoundException('Policy not found'),
        'POLICY_NOT_FOUND',
      );
    }

    const watermarked = await this.loadWatermarkedPolicyPdf({
      policy,
      recipientName: grant.accessRequest.name,
      recipientEmail: grant.subjectEmail,
      organizationName: grant.accessRequest.organization.name,
      primaryColor: grant.accessRequest.organization.primaryColor,
      docId: `policy-${policy.id}-${Date.now()}`,
    });

    const safeName = toSafeFilename(policy.name);
    const fileName = `${safeName}.pdf`;
    const key = await this.attachmentsService.uploadToS3(
      watermarked,
      `policy-${policy.id}-grant-${grant.id}-${Date.now()}.pdf`,
      'application/pdf',
      grant.accessRequest.organizationId,
      'trust_policy_downloads',
      `${grant.id}`,
    );

    const signedUrl =
      await this.attachmentsService.getPresignedDownloadUrlWithFilename(
        key,
        fileName,
      );

    return {
      signedUrl,
      fileName,
    };
  }

  async downloadAllPoliciesAsZipByAccessToken(token: string) {
    const grant = await this.grantReads.validateAccessToken(token);

    const policies = await db.policy.findMany({
      where: {
        organizationId: grant.accessRequest.organizationId,
        status: 'published',
        isArchived: false,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        content: true,
        pdfUrl: true,
        currentVersion: {
          select: {
            content: true,
            pdfUrl: true,
          },
        },
      },
      orderBy: [{ lastPublishedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    if (policies.length === 0) {
      throw new NotFoundException('No published policies available');
    }

    const organizationName =
      grant.accessRequest.organization.name || 'Organization';

    // Stream the ZIP straight into S3 instead of buffering it in memory:
    // orgs with many or large policies would otherwise OOM the worker.
    // Fixed key per grant so repeated downloads overwrite rather than
    // accumulate one bundle object per call.
    if (!s3Client || !APP_AWS_ORG_ASSETS_BUCKET) {
      throw new InternalServerErrorException(
        'Organization assets bucket is not configured',
      );
    }
    const organizationId = grant.accessRequest.organizationId;
    const zipKey = `${organizationId}/trust_policy_downloads/${grant.id}/policies.zip`;

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 6 } });
    const zipStream = new PassThrough();
    let putPromise: Promise<unknown> | undefined;

    try {
      putPromise = s3Client.send(
        new PutObjectCommand({
          Bucket: APP_AWS_ORG_ASSETS_BUCKET,
          Key: zipKey,
          Body: zipStream,
          ContentType: 'application/zip',
          Metadata: {
            organizationId,
            grantId: grant.id,
            kind: 'trust_policies_bundle',
          },
        }),
      );

      archive.on('error', (err) => {
        zipStream.destroy(err);
      });

      archive.pipe(zipStream);

      // Track filenames to avoid duplicates (case-insensitive)
      const usedNamesLower = new Set<string>();

      const getUniqueFilename = (baseName: string): string => {
        const filename = toSafeFilename(baseName);
        let counter = 1;
        let finalName = filename;

        while (usedNamesLower.has(finalName.toLowerCase())) {
          finalName = `${filename}_${counter}`;
          counter++;
        }

        usedNamesLower.add(finalName.toLowerCase());
        return `${finalName}.pdf`;
      };

      // Process policies sequentially — any failure below must abort the
      // archive and delete the partial S3 object (mirrors the documents bundle).
      for (const policy of policies) {
        const watermarkedPdf = await this.loadWatermarkedPolicyPdf({
          policy,
          recipientName: grant.accessRequest.name,
          recipientEmail: grant.subjectEmail,
          organizationName,
          primaryColor: grant.accessRequest.organization.primaryColor,
          docId: `policy-${policy.id}-${Date.now()}`,
        });

        // Add to archive
        const filename = getUniqueFilename(policy.name);
        archive.append(watermarkedPdf, { name: filename });
      }

      // Finalize the archive and wait for the S3 streaming upload.
      await archive.finalize();
      await putPromise;
    } catch (error) {
      // Ensure the streams are closed, otherwise the S3 PutObject may hang/reject later.
      try {
        archive.abort();
      } catch {
        // ignore — abort throws when the archive already finalized or was
        // never started; the destroy below carries the original error.
      }

      if (!zipStream.destroyed) {
        zipStream.destroy(
          error instanceof Error ? error : new Error('ZIP generation failed'),
        );
      }

      // Avoid unhandled rejections from an in-flight S3 put.
      await putPromise?.catch(() => undefined);

      // Delete the partially written object so failed bundles do not
      // accumulate orphan ZIPs in the bucket.
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: APP_AWS_ORG_ASSETS_BUCKET,
            Key: zipKey,
          }),
        );
      } catch {
        // ignore — the key may not exist if the put never started
      }

      throw error;
    }

    // toSafeFilename output is [a-z0-9_], safe for Content-Disposition.
    const safeOrgName = toSafeFilename(organizationName);
    const dateStr = new Date().toISOString().split('T')[0];
    const downloadFilename = `${safeOrgName}_policies_${dateStr}.zip`;

    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: APP_AWS_ORG_ASSETS_BUCKET,
        Key: zipKey,
        ResponseContentDisposition: `attachment; filename="${downloadFilename}"`,
      }),
      { expiresIn: 900 },
    );

    return {
      name: `${organizationName} - All Policies (ZIP)`,
      downloadUrl,
      policyCount: policies.length,
    };
  }

  /** Fetch-or-render one policy PDF, watermarked — shared by both downloads. */
  private async loadWatermarkedPolicyPdf(params: {
    policy: {
      id: string;
      name: string;
      content: unknown;
      pdfUrl: string | null;
      currentVersion: {
        content: unknown;
        pdfUrl: string | null;
      } | null;
    };
    recipientName: string;
    recipientEmail: string;
    organizationName: string;
    primaryColor: string | null;
    docId: string;
  }): Promise<Buffer> {
    const { policy } = params;
    const effectiveContent = policy.currentVersion?.content ?? policy.content;
    const effectivePdfUrl = policy.currentVersion?.pdfUrl ?? policy.pdfUrl;
    let buffer: Buffer | null = null;
    if (effectivePdfUrl && effectivePdfUrl.trim() !== '') {
      try {
        buffer = Buffer.from(
          await this.attachmentsService.getObjectBuffer(effectivePdfUrl),
        );
      } catch (error) {
        console.warn(
          `Failed to fetch uploaded PDF for policy ${policy.id}, falling back to content rendering:`,
          error,
        );
      }
    }
    if (!buffer) {
      buffer = this.pdfRendererService.renderPoliciesPdfBuffer(
        [{ name: policy.name, content: effectiveContent }],
        undefined,
        params.primaryColor,
      );
    }
    return this.ndaPdfService.watermarkExistingPdf(buffer, {
      organizationName: params.organizationName,
      name: params.recipientName,
      email: params.recipientEmail,
      docId: params.docId,
    });
  }
}
