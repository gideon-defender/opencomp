import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import {
  buildPublicPortalAccessUrl as buildPublicAccessUrl,
  buildPublicPortalBaseUrl as buildPublicBaseUrl,
  resolveTrustAppUrl,
} from './trust-portal-urls';
import { NdaPdfService } from './nda-pdf.service';
import { TrustPublicService } from './trust-public.service';
import { TrustGrantTokenService } from './trust-grant-token.service';
import { TrustNdaPreviewService } from './trust-nda-preview.service';

/**
 * NDA agreement flows for trust-portal grants: token reads and signed-PDF
 * recovery live here; watermarked previews live in TrustNdaPreviewService.
 * Signing lives in TrustNdaSignService. Recovery helpers stay public for
 * the signing flow, which reuses them on replay.
 */
@Injectable()
export class TrustNdaService {
  constructor(
    private readonly ndaPdfService: NdaPdfService,
    private readonly trustPublicService: TrustPublicService,
    private readonly grantTokens: TrustGrantTokenService,
    private readonly previewService: TrustNdaPreviewService,
  ) {}

  /** Preview flows live in TrustNdaPreviewService; kept here for callers. */
  async previewNda(organizationId: string, requestId: string) {
    return this.previewService.previewNda(organizationId, requestId);
  }

  async getPreviewNdaPdfBuffer(organizationId: string, requestId: string) {
    return this.previewService.getPreviewNdaPdfBuffer(
      organizationId,
      requestId,
    );
  }

  async previewNdaByToken(token: string) {
    return this.previewService.previewNdaByToken(token);
  }

  private buildPublicPortalBaseUrl(params: {
    organizationId: string;
  }): Promise<string> {
    return buildPublicBaseUrl({
      trustAppUrl: resolveTrustAppUrl(),
      organizationId: params.organizationId,
    });
  }

  private buildPublicPortalAccessUrl(params: {
    organizationId: string;
    accessToken: string;
  }): Promise<string> {
    return buildPublicAccessUrl({
      trustAppUrl: resolveTrustAppUrl(),
      organizationId: params.organizationId,
      accessToken: params.accessToken,
    });
  }

  async getNdaByToken(token: string) {
    const nda = await db.trustNDAAgreement.findUnique({
      where: { signToken: token },
      include: {
        accessRequest: {
          include: {
            organization: true,
          },
        },
        grant: true,
      },
    });

    if (!nda) {
      throw new NotFoundException('NDA agreement not found');
    }

    const portalUrl = await this.buildPublicPortalBaseUrl({
      organizationId: nda.organizationId,
    });
    const branding =
      await this.trustPublicService.getTrustBrandingByOrganizationId(
        nda.organizationId,
      );

    const baseResponse = {
      id: nda.id,
      organizationName: nda.accessRequest.organization.name,
      friendlyUrl: branding.friendlyUrl,
      faviconUrl: branding.faviconUrl,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      requesterName: nda.accessRequest.name,
      requesterEmail: nda.accessRequest.email,
      expiresAt: nda.signTokenExpiresAt,
      portalUrl,
    };

    if (nda.status === 'void') {
      return {
        ...baseResponse,
        status: 'void',
        message: 'This NDA has been revoked and is no longer valid',
      };
    }

    if (nda.status === 'signed') {
      let accessUrl: string | null = portalUrl;
      if (
        nda.grant &&
        nda.grant.status === 'active' &&
        nda.grant.expiresAt >= new Date()
      ) {
        // Rotate when the link token is missing or expired so a reopened
        // NDA link never hands out a dead access URL.
        const { accessToken } = await this.grantTokens.resolveLiveAccessToken(
          nda.grant,
        );
        accessUrl = await this.buildPublicPortalAccessUrl({
          organizationId: nda.organizationId,
          accessToken,
        });
      }

      return {
        ...baseResponse,
        status: 'signed',
        message: 'NDA has already been signed',
        portalUrl: accessUrl,
      };
    }

    // The sign-link expiry only gates unsigned agreements — a signed NDA
    // must keep resolving to its grant after the 7-day window lapses.
    if (nda.signTokenExpiresAt < new Date()) {
      return {
        ...baseResponse,
        status: 'expired',
        message: 'NDA signing link has expired',
      };
    }

    return {
      ...baseResponse,
      status: 'pending',
    };
  }

  /**
   * Rebuild a lost signed-NDA PDF. A past upload failure must not destroy
   * the legal record — the bytes are reproducible from the NDA row, so a
   * later replay regenerates, persists, and serves them.
   */
  async recoverSignedNdaPdf(nda: {
    id: string;
    organizationId: string;
    signerName: string | null;
    signerEmail: string | null;
    accessRequest: {
      name: string;
      email: string;
      organization: { name: string };
    };
  }): Promise<string> {
    const pdfBuffer = await this.ndaPdfService.generateNdaPdf({
      organizationName: nda.accessRequest.organization.name,
      signerName: nda.signerName ?? nda.accessRequest.name,
      signerEmail: nda.signerEmail ?? nda.accessRequest.email,
      agreementId: nda.id,
    });
    const pdfKey = await this.uploadSignedNdaPdfWithRetry(
      nda.organizationId,
      nda.id,
      pdfBuffer,
    );
    await db.trustNDAAgreement.update({
      where: { id: nda.id },
      data: { pdfSignedKey: pdfKey },
    });
    return pdfKey;
  }

  /**
   * Upload the signed NDA PDF with retries. Throws on persistent failure so
   * the caller retries the link instead of silently losing the record.
   */

  async uploadSignedNdaPdfWithRetry(
    organizationId: string,
    agreementId: string,
    pdfBuffer: Buffer,
    attempts = 3,
  ): Promise<string> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.ndaPdfService.uploadNdaPdf(
          organizationId,
          agreementId,
          pdfBuffer,
        );
      } catch {
        if (attempt === attempts) {
          throw new InternalServerErrorException(
            'NDA was recorded but the signed PDF upload failed — retry the signing link',
          );
        }
      }
    }
    throw new InternalServerErrorException(
      'NDA was recorded but the signed PDF upload failed — retry the signing link',
    );
  }
}
