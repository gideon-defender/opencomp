import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { generateTrustToken } from './trust-access-helpers';
import {
  buildPublicPortalAccessUrl as buildPublicAccessUrl,
  buildPublicPortalBaseUrl as buildPublicBaseUrl,
  resolveTrustAppUrl,
} from './trust-portal-urls';
import { NdaPdfService } from './nda-pdf.service';
import { TrustEmailService } from './email.service';
import { TrustGrantTokenService } from './trust-grant-token.service';
import { TrustNdaService } from './trust-nda.service';

/**
 * NDA signing flow for trust-portal grants. Split from TrustAccessService;
 * PDF recovery helpers come from TrustNdaService.
 */
@Injectable()
export class TrustNdaSignService {
  constructor(
    private readonly ndaPdfService: NdaPdfService,
    private readonly emailService: TrustEmailService,
    private readonly grantTokens: TrustGrantTokenService,
    private readonly ndaService: TrustNdaService,
  ) {}

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

  async signNda(
    token: string,
    signerName: string,
    signerEmail: string,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ) {
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

    if (nda.status === 'void') {
      throw new BadRequestException(
        'This NDA has been revoked and is no longer valid',
      );
    }

    if (nda.status === 'signed' && nda.grant) {
      // Self-healing replay: a past upload failure leaves pdfSignedKey empty
      // while the grant stays valid. Regenerate and persist instead of
      // serving a permanent null — the bytes rebuild from the NDA record.
      const signedKey =
        nda.pdfSignedKey ?? (await this.ndaService.recoverSignedNdaPdf(nda));
      const pdfUrl = signedKey
        ? await this.ndaPdfService.getSignedUrl(signedKey)
        : null;

      const now = new Date();
      const grantLive =
        nda.grant.status === 'active' && nda.grant.expiresAt >= now;
      // Rotate only for live grants — a revoked or expired grant must not
      // get a fresh token from a replayed sign link, and the response must
      // not hand out a token URL that validation would reject.
      const liveToken = grantLive
        ? await this.grantTokens.resolveLiveAccessToken(nda.grant)
        : null;
      // Carry the rotated expiry with the rotated token — handing back the
      // pre-rotation timestamp pairs a live token with an expired one.
      const accessToken = liveToken?.accessToken ?? null;

      const portalUrl = accessToken
        ? await this.buildPublicPortalAccessUrl({
            organizationId: nda.organizationId,
            accessToken,
          })
        : await this.buildPublicPortalBaseUrl({
            organizationId: nda.organizationId,
          });

      return {
        message: 'NDA already signed',
        grant:
          grantLive && liveToken
            ? {
                ...nda.grant,
                accessToken: liveToken.accessToken,
                accessTokenExpiresAt: liveToken.accessTokenExpiresAt,
              }
            : nda.grant,
        pdfDownloadUrl: pdfUrl,
        portalUrl,
        expiresAt: nda.grant.expiresAt,
      };
    }

    if (nda.status !== 'pending') {
      throw new BadRequestException('NDA has already been signed');
    }

    // The sign-link expiry only gates unsigned agreements — the signed
    // idempotent branch above must keep working after the window lapses.
    if (nda.signTokenExpiresAt < new Date()) {
      throw new BadRequestException('NDA signing link has expired');
    }

    // Bind the signature to the original access request: a forwarded or
    // leaked link must not mint grants for arbitrary email addresses.
    if (
      signerEmail.toLowerCase().trim() !==
      nda.accessRequest.email.toLowerCase().trim()
    ) {
      throw new BadRequestException(
        'Signer email must match the access request email',
      );
    }

    // Render first: pure CPU work with no side effects, safe to redo on
    // retry. The S3 upload happens after the transaction wins so the loser
    // of a double-sign race never leaves an orphan object behind.
    const pdfBuffer = await this.ndaPdfService.generateNdaPdf({
      organizationName: nda.accessRequest.organization.name,
      signerName,
      signerEmail,
      agreementId: nda.id,
    });

    const durationDays = nda.accessRequest.requestedDurationDays || 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const accessToken = generateTrustToken(32);
    // Mirror the grant's own expiry rather than a fixed window, so the
    // emailed link stays valid for the whole approved duration.
    const accessTokenExpiresAt = expiresAt;

    const result = await db.$transaction(async (tx) => {
      const grant = await tx.trustAccessGrant.create({
        data: {
          accessRequestId: nda.accessRequestId,
          // Normalized: reclaim and grant lookups match on the lowercased
          // address, so a mixed-case signature must not store the raw value.
          subjectEmail: signerEmail.toLowerCase().trim(),
          expiresAt,
          accessToken,
          accessTokenExpiresAt,
        },
      });

      // Atomic transition: a concurrent sign loses here and its grant
      // insert rolls back with the transaction.
      const transition = await tx.trustNDAAgreement.updateMany({
        where: { id: nda.id, status: 'pending' },
        data: {
          status: 'signed',
          signerName,
          signerEmail,
          signedAt: new Date(),
          grantId: grant.id,
          ipAddress,
          userAgent,
        },
      });

      if (transition.count === 0) {
        throw new BadRequestException('NDA has already been signed');
      }

      const updatedNda = await tx.trustNDAAgreement.findUniqueOrThrow({
        where: { id: nda.id },
      });

      return { grant, updatedNda };
    });

    // Upload only after winning the transition — a lost race throws above
    // before any S3 object exists. The upload retries, then fails loudly so
    // the caller retries the link; the replay branch above heals the PDF.
    const pdfKey = await this.ndaService.uploadSignedNdaPdfWithRetry(
      nda.organizationId,
      nda.id,
      pdfBuffer,
    );
    await db.trustNDAAgreement.update({
      where: { id: nda.id },
      data: { pdfSignedKey: pdfKey },
    });

    const portalUrl = await this.buildPublicPortalAccessUrl({
      organizationId: nda.organizationId,
      accessToken,
    });

    await this.emailService.sendAccessGrantedEmail({
      toEmail: signerEmail,
      toName: signerName,
      organizationName: nda.accessRequest.organization.name,
      expiresAt: result.grant.expiresAt,
      portalUrl,
      ndaBypassed: false,
    });

    const pdfUrl = pdfKey
      ? await this.ndaPdfService.getSignedUrl(pdfKey)
      : null;

    return {
      message: 'NDA signed successfully',
      grant: result.grant,
      pdfDownloadUrl: pdfUrl,
      portalUrl,
      expiresAt: result.grant.expiresAt,
    };
  }
}
