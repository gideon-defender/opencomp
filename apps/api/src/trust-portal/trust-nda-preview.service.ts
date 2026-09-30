import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { generateTrustToken, toSafeFilename } from './trust-access-helpers';
import { NdaPdfService } from './nda-pdf.service';
import { AttachmentsService } from '../attachments/attachments.service';

/**
 * Watermarked NDA preview flows: mint-on-first-view PDFs served through the
 * API. Split from TrustNdaService to keep both files focused.
 */
@Injectable()
export class TrustNdaPreviewService {
  constructor(
    private readonly ndaPdfService: NdaPdfService,
    private readonly attachmentsService: AttachmentsService,
  ) {}

  async previewNda(organizationId: string, requestId: string) {
    const request = await db.trustAccessRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
      },
      include: {
        organization: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Access request not found');
    }

    const { pdfBuffer, previewId } = await this.renderPreviewPdfBuffer({
      organizationName: request.organization.name,
      signerName: request.name,
      signerEmail: request.email,
    });

    // Fixed key per request: repeated previews overwrite instead of
    // accumulating one S3 object per call.
    const s3Key = buildPreviewS3Key(organizationId, requestId);
    await this.attachmentsService.uploadBuffer(
      s3Key,
      pdfBuffer,
      'application/pdf',
    );

    const pdfUrl = await this.ndaPdfService.getSignedUrl(s3Key);

    return {
      message: 'Preview NDA generated',
      previewId,
      s3Key,
      pdfDownloadUrl: pdfUrl,
    };
  }

  /**
   * Resolve the watermarked preview PDF bytes for browser streaming.
   * Reuses the stored preview when present; generates + persists it on first
   * view so a single GET both mints and serves the preview. Served through
   * the API (rather than the presigned S3 URL from previewNda) because the
   * S3 endpoint hostname is not reachable from browsers in local (localstack)
   * or VPC-isolated deployments.
   */
  async getPreviewNdaPdfBuffer(
    organizationId: string,
    requestId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const request = await db.trustAccessRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
      },
      include: {
        organization: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Access request not found');
    }

    // Fixed key per request (mirrors previewNda): repeated previews overwrite
    // instead of accumulating one S3 object per call.
    const s3Key = buildPreviewS3Key(organizationId, requestId);
    // The request id is a route param: slugify before reflecting it into
    // the Content-Disposition filename.
    const filename = buildPreviewFilename(requestId);
    try {
      const buffer = await this.attachmentsService.getObjectBuffer(s3Key);
      return { buffer, filename };
    } catch (error) {
      // Only a missing object means "no preview yet". Any other read
      // failure (permissions, network, empty body) must surface instead of
      // minting a replacement over a stored preview that may be intact.
      if (!isPreviewCacheMiss(error)) {
        throw error;
      }
    }

    const { pdfBuffer } = await this.renderPreviewPdfBuffer({
      organizationName: request.organization.name,
      signerName: request.name,
      signerEmail: request.email,
    });
    await this.attachmentsService.uploadBuffer(
      s3Key,
      pdfBuffer,
      'application/pdf',
    );
    return { buffer: pdfBuffer, filename };
  }

  async previewNdaByToken(token: string) {
    const nda = await db.trustNDAAgreement.findUnique({
      where: { signToken: token },
      include: {
        accessRequest: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!nda) {
      throw new NotFoundException('NDA not found or token expired');
    }

    // State before expiry (mirrors getNdaByToken): a signed or revoked
    // agreement past the 7-day window must report its state, not expiry.
    // A preview mints a PDF + S3 object per call — dead agreements must not
    // reach generation.
    if (nda.status === 'void') {
      throw new BadRequestException(
        'This NDA has been revoked and is no longer valid',
      );
    }

    if (nda.status === 'signed') {
      throw new BadRequestException('NDA has already been signed');
    }

    if (nda.signTokenExpiresAt < new Date()) {
      throw new BadRequestException('NDA signing link has expired');
    }

    const previewId = generateTrustToken(16);
    const pdfBuffer = await this.ndaPdfService.generateNdaPdf({
      organizationName: nda.accessRequest.organization.name,
      signerName: nda.accessRequest.name,
      signerEmail: nda.accessRequest.email,
      agreementId: `preview-${previewId}`,
    });

    // Fixed key per agreement: repeated previews overwrite instead of
    // accumulating one S3 object per call.
    const s3Key = `${nda.organizationId}/trust_nda/preview-nda-${nda.id}.pdf`;
    await this.attachmentsService.uploadBuffer(
      s3Key,
      pdfBuffer,
      'application/pdf',
    );

    const pdfUrl = await this.ndaPdfService.getSignedUrl(s3Key);

    return {
      message: 'Preview NDA generated',
      previewId,
      s3Key,
      pdfDownloadUrl: pdfUrl,
    };
  }

  /**
   * Render a fresh watermarked preview PDF. The previewId makes each render
   * traceable (stamped into the PDF as agreementId) even though the S3 key
   * is fixed per request.
   */
  private async renderPreviewPdfBuffer(params: {
    organizationName: string;
    signerName: string;
    signerEmail: string;
  }): Promise<{ pdfBuffer: Buffer; previewId: string }> {
    const previewId = generateTrustToken(16);
    const pdfBuffer = await this.ndaPdfService.generateNdaPdf({
      ...params,
      agreementId: `preview-${previewId}`,
    });
    return { pdfBuffer, previewId };
  }
}

/** Fixed S3 key per request so repeated previews overwrite one object. */
export function buildPreviewS3Key(
  organizationId: string,
  requestId: string,
): string {
  return `${organizationId}/trust_nda/preview-${requestId}.pdf`;
}

/** Slugified filename so the route param never reaches a header raw. */
export function buildPreviewFilename(requestId: string): string {
  return `${toSafeFilename(`nda-preview-${requestId}`)}.pdf`;
}

/**
 * True only when an S3 read failed because the object is missing. AWS SDK
 * v3 reports this as `NoSuchKey` (or `NotFound` on S3-compatible stores);
 * anything else (permissions, network, empty body) must propagate.
 */
export function isPreviewCacheMiss(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  if (name === 'NoSuchKey' || name === 'NotFound') {
    return true;
  }
  const metadata = (error as { $metadata?: unknown }).$metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    (metadata as { httpStatusCode?: unknown }).httpStatusCode === 404
  ) {
    return true;
  }
  return false;
}
