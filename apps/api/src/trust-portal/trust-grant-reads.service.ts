import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { APP_AWS_ORG_ASSETS_BUCKET, s3Client, getSignedUrl } from '../app/s3';
import { toSafeFilenameWithExtension } from './trust-access-helpers';
import { NdaPdfService } from './nda-pdf.service';
import { TrustPublicService } from './trust-public.service';

/**
 * Token-gated reads for trust-portal grants (grant summary, published
 * policies, compliance resources, additional documents). Split from
 * TrustAccessService so grant reads evolve separately from the request
 * lifecycle, NDA, and download flows.
 */
@Injectable()
export class TrustGrantReadsService {
  constructor(
    private readonly ndaPdfService: NdaPdfService,
    private readonly trustPublicService: TrustPublicService,
  ) {}
  async getGrantByAccessToken(token: string) {
    const grant = await db.trustAccessGrant.findUnique({
      where: { accessToken: token },
      include: {
        accessRequest: {
          include: {
            organization: true,
          },
        },
        ndaAgreement: true,
      },
    });

    if (!grant) {
      throw new NotFoundException('Invalid access token');
    }

    if (grant.status !== 'active') {
      throw new BadRequestException('Access grant is not active');
    }

    if (grant.expiresAt < new Date()) {
      throw new BadRequestException('Access grant has expired');
    }

    if (
      !grant.accessTokenExpiresAt ||
      grant.accessTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException('Access token has expired');
    }

    const ndaPdfUrl = grant.ndaAgreement?.pdfSignedKey
      ? await this.ndaPdfService.getSignedUrl(grant.ndaAgreement.pdfSignedKey)
      : null;
    const branding =
      await this.trustPublicService.getTrustBrandingByOrganizationId(
        grant.accessRequest.organizationId,
      );

    return {
      organizationName: grant.accessRequest.organization.name,
      friendlyUrl: branding.friendlyUrl,
      faviconUrl: branding.faviconUrl,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      securityQuestionnaireEnabled: branding.securityQuestionnaireEnabled,
      expiresAt: grant.expiresAt,
      subjectEmail: grant.subjectEmail,
      ndaPdfUrl,
    };
  }

  async validateAccessTokenAndGetOrganizationId(
    token: string,
  ): Promise<string> {
    const grant = await this.validateAccessToken(token);
    return grant.accessRequest.organizationId;
  }

  async validateAccessToken(token: string) {
    const grant = await db.trustAccessGrant.findUnique({
      where: { accessToken: token },
      include: {
        accessRequest: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!grant) {
      throw new NotFoundException('Invalid access token');
    }

    if (grant.status !== 'active') {
      throw new BadRequestException('Access grant is not active');
    }

    if (grant.expiresAt < new Date()) {
      throw new BadRequestException('Access grant has expired');
    }

    if (
      !grant.accessTokenExpiresAt ||
      grant.accessTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException('Access token has expired');
    }

    return grant;
  }

  async getPoliciesByAccessToken(token: string) {
    const grant = await this.validateAccessToken(token);

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
        description: true,
        lastPublishedAt: true,
        updatedAt: true,
        currentVersion: {
          select: {
            id: true,
            version: true,
          },
        },
      },
      orderBy: [{ lastPublishedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    return policies;
  }

  async getComplianceResourcesByAccessToken(token: string) {
    const grant = await this.validateAccessToken(token);

    const complianceResources = await db.trustResource.findMany({
      where: {
        organizationId: grant.accessRequest.organizationId,
      },
      select: {
        framework: true,
        customFrameworkId: true,
        customFramework: { select: { name: true } },
        fileName: true,
        fileSize: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Return all resources - the download endpoint will auto-enable frameworks as needed.
    // Custom-framework certificates carry customFrameworkId + the framework name so the
    // gated access page can label and download them (native ones keep `framework`).
    return complianceResources.map((resource) => ({
      framework: resource.framework,
      customFrameworkId: resource.customFrameworkId,
      customFrameworkName: resource.customFramework?.name ?? null,
      fileName: resource.fileName,
      fileSize: resource.fileSize,
      updatedAt: resource.updatedAt.toISOString(),
    }));
  }

  async getTrustDocumentsByAccessToken(token: string) {
    const grant = await this.validateAccessToken(token);

    const documents = await db.trustDocument.findMany({
      where: {
        organizationId: grant.accessRequest.organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return documents.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));
  }

  async getTrustDocumentUrlByAccessToken(token: string, documentId: string) {
    const grant = await this.validateAccessToken(token);

    if (!s3Client || !APP_AWS_ORG_ASSETS_BUCKET) {
      throw new InternalServerErrorException(
        'Organization assets bucket is not configured',
      );
    }

    const document = await db.trustDocument.findFirst({
      where: {
        id: documentId,
        organizationId: grant.accessRequest.organizationId,
        isActive: true,
      },
      select: {
        name: true,
        s3Key: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const getCommand = new GetObjectCommand({
      Bucket: APP_AWS_ORG_ASSETS_BUCKET,
      Key: document.s3Key,
      ResponseContentDisposition: `attachment; filename="${toSafeFilenameWithExtension(document.name)}"`,
    });

    const signedUrl = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 900,
    });

    return {
      signedUrl,
      fileName: document.name,
    };
  }

  async listGrants(organizationId: string) {
    const now = new Date();

    // Update expired grants that are still marked as active
    await db.trustAccessGrant.updateMany({
      where: {
        accessRequest: {
          organizationId,
        },
        status: 'active',
        expiresAt: {
          lt: now,
        },
      },
      data: {
        status: 'expired',
      },
    });

    const grants = await db.trustAccessGrant.findMany({
      where: {
        accessRequest: {
          organizationId,
        },
      },
      include: {
        accessRequest: {
          select: {
            name: true,
            email: true,
            company: true,
            purpose: true,
          },
        },
        issuedBy: {
          select: {
            user: { select: { name: true, email: true } },
          },
        },
        revokedBy: {
          select: {
            user: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return grants;
  }
}
