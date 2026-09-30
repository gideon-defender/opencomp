import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { getSignedUrl } from '../app/s3';
import { CreateAccessRequestDto } from './dto/trust-access.dto';
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
import { TrustPublicCatalogService } from './trust-public-catalog.service';
import { TrustPublicService } from './trust-public.service';
import { NdaPdfService } from './nda-pdf.service';
import { TrustEmailService } from './email.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { PolicyPdfRendererService } from './policy-pdf-renderer.service';
import { TrustCustomFrameworkService } from './trust-custom-framework.service';

jest.mock('@db', () => ({
  db: {
    trust: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    trustNDAAgreement: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    trustAccessGrant: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    trustAccessRequest: {
      findFirst: jest.fn(),
    },
    member: {
      findFirst: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    policy: {
      findMany: jest.fn(),
    },
    control: {
      findMany: jest.fn(),
    },
    trustResource: {
      findMany: jest.fn(),
    },
    vendor: {
      findMany: jest.fn(),
    },
    trustCustomLink: {
      findMany: jest.fn(),
    },
    trustDocument: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    globalVendors: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;

      constructor(code: string) {
        super();
        this.code = code;
      }
    },
  },
  TrustFramework: {
    iso_27001: 'iso_27001',
    iso_42001: 'iso_42001',
    gdpr: 'gdpr',
    hipaa: 'hipaa',
    soc2_type1: 'soc2_type1',
    soc2_type2: 'soc2_type2',
    soc3: 'soc3',
    pci_dss: 'pci_dss',
    nen_7510: 'nen_7510',
    iso_9001: 'iso_9001',
    pipeda: 'pipeda',
    ccpa: 'ccpa',
    dora: 'dora',
    nis_2: 'nis_2',
    hitrust_csf: 'hitrust_csf',
    nist_csf: 'nist_csf',
    nist_800_53: 'nist_800_53',
  },
}));

jest.mock('../app/s3', () => ({
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  s3Client: { send: jest.fn() },
  getSignedUrl: jest.fn(),
}));

const mockDb = db as unknown as {
  trust: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  trustNDAAgreement: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  trustAccessGrant: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  trustAccessRequest: {
    findFirst: jest.Mock;
  };
  member: {
    findFirst: jest.Mock;
  };
  organization: {
    findUnique: jest.Mock;
  };
  policy: {
    findMany: jest.Mock;
  };
  control: {
    findMany: jest.Mock;
  };
  trustResource: {
    findMany: jest.Mock;
  };
  vendor: {
    findMany: jest.Mock;
  };
  trustCustomLink: {
    findMany: jest.Mock;
  };
  trustDocument: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  globalVendors: {
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<
  typeof getSignedUrl
>;

function createAccessService(input: {
  ndaPdf?: unknown;
  email?: unknown;
  attachments?: unknown;
  trustPublic?: TrustPublicService;
}) {
  const ndaPdfService = (input.ndaPdf ?? {}) as unknown as NdaPdfService;
  const emailService = (input.email ?? {}) as unknown as TrustEmailService;
  const attachmentsService = (input.attachments ??
    {}) as unknown as AttachmentsService;
  const trustPublicService =
    input.trustPublic ??
    new TrustPublicService({} as unknown as TrustCustomFrameworkService);
  const pdfRendererService = {} as unknown as PolicyPdfRendererService;
  const grantReads = new TrustGrantReadsService(
    ndaPdfService,
    trustPublicService,
  );
  const grantTokens = new TrustGrantTokenService(emailService);
  const documentDownloads = new TrustDocumentDownloadService(grantReads);
  const resourceDownloads = new TrustResourceDownloadService(
    attachmentsService,
    ndaPdfService,
    grantReads,
  );
  const policyDownloads = new TrustPolicyDownloadService(
    attachmentsService,
    pdfRendererService,
    ndaPdfService,
    grantReads,
  );
  const policyFileDownloads = new TrustPolicyFileDownloadService(
    attachmentsService,
    pdfRendererService,
    ndaPdfService,
    grantReads,
  );
  const previewService = new TrustNdaPreviewService(
    ndaPdfService,
    attachmentsService,
  );
  const ndaService = new TrustNdaService(
    ndaPdfService,
    trustPublicService,
    grantTokens,
    previewService,
  );
  const ndaSignService = new TrustNdaSignService(
    ndaPdfService,
    emailService,
    grantTokens,
    ndaService,
  );
  const intakeService = new TrustRequestIntakeService(
    emailService,
    grantTokens,
  );
  const approvalService = new TrustRequestApprovalService(emailService);
  const moderationService = new TrustRequestModerationService();
  const resendService = new TrustRequestResendService(
    emailService,
    grantTokens,
  );
  const service = new TrustAccessService(
    grantReads,
    grantTokens,
    documentDownloads,
    resourceDownloads,
    policyDownloads,
    policyFileDownloads,
    ndaService,
    ndaSignService,
    intakeService,
    approvalService,
    moderationService,
    resendService,
  );
  return {
    service,
    emailService,
    ndaPdfService,
    attachmentsService,
    trustPublicService,
    grantReads,
    grantTokens,
    ndaService,
    ndaSignService,
    intakeService,
    approvalService,
    moderationService,
    resendService,
  };
}

describe('TrustPublicCatalogService getPublicVendors compliance badges (CS-688)', () => {
  const service = new TrustPublicCatalogService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'published',
    });
  });

  // Regression: the public Trust Centre served a stale stored badge set
  // (GDPR only) for Scaleway while the vendor's verified certifications include
  // ISO 27001. The public path must derive badges from the certification data,
  // not trust the stale stored value.
  it('derives ISO 27001 from cert data even when stored badges are stale (GDPR only)', async () => {
    mockDb.vendor.findMany.mockResolvedValue([
      {
        id: 'vnd_scaleway',
        name: 'Scaleway',
        description: null,
        website: 'scaleway.com',
        logoUrl: null,
        complianceBadges: [{ type: 'gdpr', verified: true }],
      },
    ]);
    mockDb.globalVendors.findMany.mockResolvedValue([
      {
        website: 'scaleway.com',
        riskAssessmentData: {
          certifications: [
            { type: 'ISO/IEC 27001:2022', status: 'verified' },
            { type: 'HDS', status: 'verified' },
            { type: 'GDPR Compliance', status: 'verified' },
          ],
        },
      },
    ]);

    const result = await service.getPublicVendors('capawesome');
    const types = result[0].complianceBadges.map((b) => b.type);

    expect(types).toContain('iso27001');
    expect(types).toContain('gdpr');
  });

  it('keeps the stored badges when there is no derivable cert data', async () => {
    mockDb.vendor.findMany.mockResolvedValue([
      {
        id: 'vnd_x',
        name: 'X',
        description: null,
        website: 'x.com',
        logoUrl: null,
        complianceBadges: [{ type: 'soc2', verified: true }],
      },
    ]);
    mockDb.globalVendors.findMany.mockResolvedValue([]);

    const result = await service.getPublicVendors('capawesome');
    const types = result[0].complianceBadges.map((b) => b.type);

    expect(types).toEqual(['soc2']);
  });
});

describe('TrustPublicService public portal data', () => {
  const service = new TrustPublicService(
    {} as unknown as TrustCustomFrameworkService,
  );
  const catalogService = new TrustPublicCatalogService();

  const publishedTrust = {
    organizationId: 'org_1',
    friendlyUrl: 'acme',
    domain: null,
    domainVerified: false,
    contactEmail: 'security@acme.com',
    status: 'published',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the public profile for a published portal', async () => {
    mockDb.trust.findUnique.mockResolvedValue(publishedTrust);
    mockDb.organization.findUnique.mockResolvedValue({
      name: 'Acme',
      primaryColor: '#065f46',
    });

    const result = await service.getPublicProfile('acme');

    expect(result).toEqual({
      organizationName: 'Acme',
      domain: null,
      domainVerified: false,
      friendlyUrl: 'acme',
      primaryColor: '#065f46',
      contactEmail: 'security@acme.com',
    });
  });

  it('throws NotFound for a missing or draft portal profile', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);
    await expect(service.getPublicProfile('nope')).rejects.toThrow();

    mockDb.trust.findUnique.mockResolvedValue({
      ...publishedTrust,
      status: 'draft',
    });
    await expect(service.getPublicProfile('acme')).rejects.toThrow();
  });

  it('lists only enabled frameworks with certificate presence', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      ...publishedTrust,
      dora: true,
      dora_status: 'compliant',
      nis_2: true,
      nis_2_status: 'in_progress',
      iso27001: false,
    });
    mockDb.trustResource.findMany.mockResolvedValue([{ framework: 'dora' }]);

    const result = await catalogService.getPublicFrameworks('acme');

    expect(result).toEqual([
      {
        key: 'dora',
        title: 'DORA',
        status: 'compliant',
        hasCertificate: true,
      },
      {
        key: 'nis_2',
        title: 'NIS 2',
        status: 'in_progress',
        hasCertificate: false,
      },
    ]);
  });

  it('returns empty frameworks for a missing portal', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);

    await expect(catalogService.getPublicFrameworks('nope')).resolves.toEqual(
      [],
    );
  });

  it('lists published policies without content', async () => {
    mockDb.trust.findUnique.mockResolvedValue(publishedTrust);
    mockDb.policy.findMany.mockResolvedValue([
      { id: 'pol_1', name: 'Privacy Policy', updatedAt: new Date() },
    ]);

    const result = await service.getPublicPolicies('acme');

    expect(mockDb.policy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org_1',
          status: 'published',
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('content');
  });

  it('lists non-archived controls', async () => {
    mockDb.trust.findUnique.mockResolvedValue(publishedTrust);
    mockDb.control.findMany.mockResolvedValue([{ id: 'ctl_1', name: 'MFA' }]);

    const result = await service.getPublicControls('acme');

    expect(mockDb.control.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org_1' }),
      }),
    );
    expect(result).toEqual([{ id: 'ctl_1', name: 'MFA' }]);
  });
});

describe('TrustAccessService favicon branding', () => {
  const publicService = new TrustPublicService(
    {} as unknown as TrustCustomFrameworkService,
  );
  const { service } = createAccessService({
    ndaPdf: { getSignedUrl: jest.fn() },
    trustPublic: publicService,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads branding through the injected public service, not a private copy', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const getTrustBrandingByOrganizationId = jest.fn().mockResolvedValue({
      friendlyUrl: 'acme-security',
      faviconUrl: null,
      securityQuestionnaireEnabled: false,
    });
    const { service: injected } = createAccessService({
      ndaPdf: { getSignedUrl: jest.fn() },
      trustPublic: {
        getTrustBrandingByOrganizationId,
      } as unknown as TrustPublicService,
    });
    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      id: 'grant_1',
      status: 'active',
      expiresAt: futureDate,
      accessTokenExpiresAt: futureDate,
      subjectEmail: 'alice@example.com',
      accessRequest: {
        organizationId: 'org_123',
        name: 'Alice',
        organization: { name: 'Acme Security' },
      },
      ndaAgreement: null,
    });

    const result = await injected.getGrantByAccessToken('grant-token');

    expect(getTrustBrandingByOrganizationId).toHaveBeenCalledWith('org_123');
    expect(result.friendlyUrl).toBe('acme-security');
  });

  it('falls back to organizationId lookup when getPublicFavicon route id is not a friendlyUrl', async () => {
    mockDb.trust.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      favicon: 'org_123/trust/favicon/icon.png',
      status: 'published',
    });
    mockGetSignedUrl.mockResolvedValue('https://cdn.example.com/favicon.png');

    const result = await publicService.getPublicFavicon('org_123');

    expect(mockDb.trust.findUnique).toHaveBeenNthCalledWith(1, {
      where: { friendlyUrl: 'org_123' },
      select: { favicon: true, status: true },
    });
    expect(mockDb.trust.findUnique).toHaveBeenNthCalledWith(2, {
      where: { organizationId: 'org_123' },
      select: { favicon: true, status: true },
    });
    expect(result).toBe('https://cdn.example.com/favicon.png');
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockGetSignedUrl.mock.calls[0][1]).toBeInstanceOf(GetObjectCommand);
  });

  it('includes friendlyUrl and faviconUrl in getGrantByAccessToken response', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);

    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      id: 'grant_1',
      status: 'active',
      expiresAt: futureDate,
      accessTokenExpiresAt: futureDate,
      subjectEmail: 'alice@example.com',
      accessRequest: {
        organizationId: 'org_123',
        name: 'Alice',
        organization: {
          name: 'Acme Security',
        },
      },
      ndaAgreement: null,
    });
    mockDb.trust.findUnique.mockResolvedValue({
      friendlyUrl: 'acme-security',
      favicon: 'org_123/trust/favicon/icon.png',
    });
    mockGetSignedUrl.mockResolvedValue('https://cdn.example.com/favicon.png');

    const result = await service.getGrantByAccessToken('grant-token');

    expect(result).toMatchObject({
      organizationName: 'Acme Security',
      friendlyUrl: 'acme-security',
      faviconUrl: 'https://cdn.example.com/favicon.png',
      subjectEmail: 'alice@example.com',
    });
  });

  it('rejects an unknown access token', async () => {
    mockDb.trustAccessGrant.findUnique.mockResolvedValue(null);

    await expect(service.getGrantByAccessToken('bogus')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a revoked grant', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      id: 'grant_1',
      status: 'revoked',
      expiresAt: futureDate,
      accessTokenExpiresAt: futureDate,
      accessRequest: { organizationId: 'org_123' },
    });

    await expect(
      service.getGrantByAccessToken('grant-token'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired grant', async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      id: 'grant_1',
      status: 'active',
      expiresAt: pastDate,
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      accessRequest: { organizationId: 'org_123' },
    });

    await expect(service.getGrantByAccessToken('grant-token')).rejects.toThrow(
      'Access grant has expired',
    );
  });

  it('rejects an expired link token on a live grant', async () => {
    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      id: 'grant_1',
      status: 'active',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      accessRequest: { organizationId: 'org_123' },
    });

    await expect(service.getGrantByAccessToken('grant-token')).rejects.toThrow(
      'Access token has expired',
    );
  });

  it('includes friendlyUrl and faviconUrl in getNdaByToken response', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);

    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      id: 'nda_1',
      organizationId: 'org_123',
      signTokenExpiresAt: futureDate,
      status: 'pending',
      accessRequest: {
        name: 'Alice',
        email: 'alice@example.com',
        organization: {
          name: 'Acme Security',
        },
      },
      grant: null,
    });
    mockDb.trust.findUnique
      .mockResolvedValueOnce({
        domain: null,
        domainVerified: false,
        friendlyUrl: 'acme-security',
      })
      .mockResolvedValueOnce({
        friendlyUrl: 'acme-security',
        favicon: 'org_123/trust/favicon/icon.png',
      });
    mockGetSignedUrl.mockResolvedValue('https://cdn.example.com/favicon.png');

    const result = await service.getNdaByToken('nda-token');

    expect(result).toMatchObject({
      id: 'nda_1',
      status: 'pending',
      organizationName: 'Acme Security',
      friendlyUrl: 'acme-security',
      faviconUrl: 'https://cdn.example.com/favicon.png',
    });
    expect(result.portalUrl).toContain('/acme-security');
  });

  it('reports expired status for an NDA with a past signTokenExpiresAt', async () => {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      id: 'nda_1',
      organizationId: 'org_123',
      signTokenExpiresAt: new Date(Date.now() - 1000),
      status: 'pending',
      accessRequest: {
        name: 'Alice',
        email: 'alice@example.com',
        organization: {
          name: 'Acme Security',
        },
      },
      grant: null,
    });
    mockDb.trust.findUnique.mockResolvedValue({
      domain: null,
      domainVerified: false,
      friendlyUrl: 'acme-security',
      favicon: null,
      securityQuestionnaireEnabled: true,
    });

    const result = await service.getNdaByToken('nda-token');

    expect(result).toMatchObject({ id: 'nda_1', status: 'expired' });
  });
});

describe('TrustAccessService approveRequest NDA bypass', () => {
  const emailService = {
    sendAccessGrantedEmail: jest.fn(),
    sendNdaSigningEmail: jest.fn(),
  };
  const { service, approvalService } = createAccessService({
    email: emailService,
  });
  const buildPortalAccessUrlSpy = jest.spyOn(
    approvalService as unknown as {
      buildPortalAccessUrl: () => Promise<string>;
    },
    'buildPortalAccessUrl',
  );

  const baseRequest = {
    id: 'tar_1',
    status: 'under_review',
    email: 'chang.liu@client.com',
    name: 'Chang Liu',
    requestedDurationDays: 30,
    organization: { name: 'Acme Security' },
  };

  let txMock: {
    trustAccessRequest: {
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    trustAccessGrant: { create: jest.Mock };
    trustNDAAgreement: { create: jest.Mock; updateMany: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    txMock = {
      trustAccessRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'tar_1', status: 'approved' }),
      },
      trustAccessGrant: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'tag_1', expiresAt: new Date() }),
      },
      trustNDAAgreement: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'tna_1', signToken: 'sign-token' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(baseRequest);
    mockDb.member.findFirst.mockResolvedValue({ id: 'mem_1', userId: 'usr_1' });
    mockDb.$transaction.mockImplementation(
      (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
    );
    buildPortalAccessUrlSpy.mockResolvedValue(
      'https://portal.example.com/access/token',
    );
  });

  it('bypasses NDA when the exact email is allow-listed', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      allowedDomains: [],
      allowedEmails: ['chang.liu@client.com'],
    });

    const result = await service.approveRequest('org_1', 'tar_1', {}, 'mem_1');

    expect(txMock.trustAccessGrant.create).toHaveBeenCalledTimes(1);
    expect(txMock.trustNDAAgreement.create).not.toHaveBeenCalled();
    expect(emailService.sendAccessGrantedEmail).toHaveBeenCalledTimes(1);
    // The granted email must omit NDA copy since no NDA was signed.
    expect(emailService.sendAccessGrantedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ndaBypassed: true }),
    );
    expect(emailService.sendNdaSigningEmail).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          data: expect.objectContaining({
            ndaBypassed: true,
            bypassReason: 'allowed email',
          }),
        }),
      }),
    );
    expect(result.message).toBe('Access granted');
  });

  it('bypasses NDA via domain match and records the domain reason', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      allowedDomains: ['client.com'],
      allowedEmails: [],
    });

    await service.approveRequest('org_1', 'tar_1', {}, 'mem_1');

    expect(txMock.trustAccessGrant.create).toHaveBeenCalledTimes(1);
    expect(emailService.sendAccessGrantedEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendAccessGrantedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ndaBypassed: true }),
    );
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          data: expect.objectContaining({ bypassReason: 'allowed domain' }),
        }),
      }),
    );
  });

  it('requires NDA signing when neither email nor domain is allow-listed', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      allowedDomains: ['other.com'],
      allowedEmails: ['someone@else.com'],
    });

    const result = await service.approveRequest('org_1', 'tar_1', {}, 'mem_1');

    expect(txMock.trustNDAAgreement.create).toHaveBeenCalledTimes(1);
    expect(txMock.trustAccessGrant.create).not.toHaveBeenCalled();
    expect(emailService.sendNdaSigningEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendAccessGrantedEmail).not.toHaveBeenCalled();
    expect(result.message).toBe('NDA signing email sent');
  });
});

describe('TrustAccessService resendAccessGrantEmail NDA copy', () => {
  const emailService = {
    sendAccessGrantedEmail: jest.fn(),
  };
  const { service, resendService } = createAccessService({
    email: emailService,
  });
  jest
    .spyOn(
      resendService as unknown as {
        buildPortalAccessUrl: () => Promise<string>;
      },
      'buildPortalAccessUrl',
    )
    .mockResolvedValue('https://portal.example.com/access/token');

  const baseGrant = {
    id: 'tag_1',
    subjectEmail: 'chang.liu@client.com',
    status: 'active',
    expiresAt: new Date(Date.now() + 86_400_000),
    accessToken: 'existing-token',
    accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
    accessRequest: {
      name: 'Chang Liu',
      organization: { name: 'Acme Security' },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks the resent email as bypassed when the grant has no NDA agreement', async () => {
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      ...baseGrant,
      ndaAgreement: null,
    });

    await service.resendAccessGrantEmail('org_1', 'tag_1');

    expect(emailService.sendAccessGrantedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ndaBypassed: true }),
    );
  });

  it('keeps NDA copy when the grant has a signed NDA agreement', async () => {
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      ...baseGrant,
      ndaAgreement: { status: 'signed' },
    });

    await service.resendAccessGrantEmail('org_1', 'tag_1');

    expect(emailService.sendAccessGrantedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ndaBypassed: false }),
    );
  });

  it('rotates an expired token to expire with the grant, not a fixed 24h window', async () => {
    const grantExpiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      ...baseGrant,
      expiresAt: grantExpiresAt,
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      ndaAgreement: null,
    });

    await service.resendAccessGrantEmail('org_1', 'tag_1');

    expect(mockDb.trustAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tag_1', accessToken: 'existing-token' },
      data: expect.objectContaining({ accessTokenExpiresAt: grantExpiresAt }),
    });
  });
});

describe('TrustAccessService signNda NDA copy', () => {
  const ndaPdfService = {
    generateNdaPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    uploadNdaPdf: jest.fn().mockResolvedValue('org_1/nda/nda_1.pdf'),
    getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/nda.pdf'),
  };
  const emailService = {
    sendAccessGrantedEmail: jest.fn(),
  };
  const { service, ndaSignService } = createAccessService({
    ndaPdf: ndaPdfService,
    email: emailService,
  });
  jest
    .spyOn(
      ndaSignService as unknown as {
        buildPublicPortalAccessUrl: () => Promise<string>;
      },
      'buildPublicPortalAccessUrl',
    )
    .mockResolvedValue('https://portal.example.com/access/token');

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      id: 'nda_1',
      organizationId: 'org_1',
      accessRequestId: 'tar_1',
      status: 'pending',
      signTokenExpiresAt: new Date(Date.now() + 86_400_000),
      grant: null,
      accessRequest: {
        requestedDurationDays: 30,
        email: 'chang.liu@client.com',
        organization: { name: 'Acme Security' },
      },
    });
    mockDb.$transaction.mockImplementation(
      (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          trustAccessGrant: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'tag_1', expiresAt: new Date() }),
          },
          trustNDAAgreement: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'nda_1' }),
          },
        }),
    );
  });

  it('sends the granted email with NDA copy (ndaBypassed: false) after signing', async () => {
    await service.signNda(
      'sign-token',
      'Chang Liu',
      'chang.liu@client.com',
      '1.2.3.4',
      'jest-agent',
    );

    expect(emailService.sendAccessGrantedEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendAccessGrantedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ndaBypassed: false }),
    );
  });

  it('rejects a signer email that does not match the access request', async () => {
    await expect(
      service.signNda(
        'sign-token',
        'Mallory',
        'mallory@evil.com',
        '1.2.3.4',
        'jest-agent',
      ),
    ).rejects.toThrow('Signer email must match the access request email');

    expect(emailService.sendAccessGrantedEmail).not.toHaveBeenCalled();
  });

  it('stores a normalized subjectEmail when the signer uses mixed case', async () => {
    const created: Array<{ subjectEmail: string }> = [];
    mockDb.$transaction.mockImplementationOnce(
      (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          trustAccessGrant: {
            create: jest
              .fn()
              .mockImplementation(
                (args: { data: { subjectEmail: string } }) => {
                  created.push(args.data);
                  return Promise.resolve({
                    id: 'tag_1',
                    expiresAt: new Date(),
                  });
                },
              ),
          },
          trustNDAAgreement: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'nda_1' }),
          },
        }),
    );

    await service.signNda(
      'sign-token',
      'Chang Liu',
      'Chang.Liu@Client.com',
      '1.2.3.4',
      'jest-agent',
    );

    expect(created).toHaveLength(1);
    // Reclaim/grant lookups match on the lowercased address — the raw
    // mixed-case value would leave the grant unreachable.
    expect(created[0]?.subjectEmail).toBe('chang.liu@client.com');
  });
});

describe('TrustAccessService previewNdaByToken state guards', () => {
  const ndaPdfService = {
    generateNdaPdf: jest.fn(),
    uploadNdaPdf: jest.fn(),
    getSignedUrl: jest.fn(),
  };
  const { service } = createAccessService({ ndaPdf: ndaPdfService });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockNda(status: string) {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      id: 'nda_1',
      organizationId: 'org_1',
      status,
      signTokenExpiresAt: new Date(Date.now() + 86_400_000),
      accessRequest: {
        name: 'Chang Liu',
        email: 'chang.liu@client.com',
        organization: { name: 'Acme Security' },
      },
    });
  }

  it('rejects a revoked (void) NDA without generating a PDF', async () => {
    mockNda('void');

    await expect(service.previewNdaByToken('sign-token')).rejects.toThrow(
      'This NDA has been revoked and is no longer valid',
    );

    expect(ndaPdfService.generateNdaPdf).not.toHaveBeenCalled();
    expect(ndaPdfService.uploadNdaPdf).not.toHaveBeenCalled();
  });

  it('rejects an already-signed NDA without generating a PDF', async () => {
    mockNda('signed');

    await expect(service.previewNdaByToken('sign-token')).rejects.toThrow(
      'NDA has already been signed',
    );

    expect(ndaPdfService.generateNdaPdf).not.toHaveBeenCalled();
    expect(ndaPdfService.uploadNdaPdf).not.toHaveBeenCalled();
  });
});

describe('TrustAccessService reclaimAccess token rotation', () => {
  const emailService = {
    sendAccessReclaimEmail: jest.fn(),
  };
  const { service, grantTokens } = createAccessService({
    email: emailService,
  });
  jest
    .spyOn(
      grantTokens as unknown as {
        buildPublicPortalAccessUrl: () => Promise<string>;
      },
      'buildPublicPortalAccessUrl',
    )
    .mockResolvedValue('https://portal.example.com/access/token');

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      friendlyUrl: 'acme-security',
      status: 'published',
    });
  });

  it('rotates an expired access token to expire with the grant, not a fixed 24h window', async () => {
    const grantExpiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      id: 'tag_1',
      subjectEmail: 'chang.liu@client.com',
      status: 'active',
      expiresAt: grantExpiresAt,
      accessToken: 'stale-token',
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      accessRequest: {
        name: 'Chang Liu',
        organization: { name: 'Acme Security' },
      },
      ndaAgreement: null,
    });

    await service.reclaimAccess('acme-security', 'chang.liu@client.com');

    expect(mockDb.trustAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tag_1', accessToken: 'stale-token' },
      data: expect.objectContaining({ accessTokenExpiresAt: grantExpiresAt }),
    });
  });

  it('rotates when the link token is null', async () => {
    const grantExpiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      id: 'tag_1',
      subjectEmail: 'chang.liu@client.com',
      status: 'active',
      expiresAt: grantExpiresAt,
      accessToken: null,
      accessTokenExpiresAt: null,
      accessRequest: {
        name: 'Chang Liu',
        organization: { name: 'Acme Security' },
      },
      ndaAgreement: null,
    });

    await service.reclaimAccess('acme-security', 'chang.liu@client.com');

    expect(mockDb.trustAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tag_1', accessToken: null },
      data: expect.objectContaining({
        accessToken: expect.any(String),
        accessTokenExpiresAt: grantExpiresAt,
      }),
    });
    expect(emailService.sendAccessReclaimEmail).toHaveBeenCalledTimes(1);
  });

  it('returns a generic message without a link when no grant exists', async () => {
    mockDb.trustAccessGrant.findFirst.mockResolvedValue(null);

    const result = await service.reclaimAccess(
      'acme-security',
      'nobody@example.com',
    );

    expect(result).toEqual({
      message:
        'If an active grant exists for this email, an access link was sent',
    });
    expect(result).not.toHaveProperty('accessLink');
    expect(emailService.sendAccessReclaimEmail).not.toHaveBeenCalled();
  });

  it('never returns the access link in the success response', async () => {
    const grantExpiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      id: 'tag_1',
      subjectEmail: 'chang.liu@client.com',
      status: 'active',
      expiresAt: grantExpiresAt,
      accessToken: 'live-token',
      accessTokenExpiresAt: grantExpiresAt,
      accessRequest: {
        name: 'Chang Liu',
        organization: { name: 'Acme Security' },
      },
      ndaAgreement: null,
    });

    const result = await service.reclaimAccess(
      'acme-security',
      'chang.liu@client.com',
    );

    expect(result).not.toHaveProperty('accessLink');
    expect(emailService.sendAccessReclaimEmail).toHaveBeenCalledTimes(1);
    // Live token: rotation must not persist anything.
    expect(mockDb.trustAccessGrant.updateMany).not.toHaveBeenCalled();
  });

  it('reuses the winners token when a concurrent rotation wins the race', async () => {
    const grantExpiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      id: 'tag_1',
      subjectEmail: 'chang.liu@client.com',
      status: 'active',
      expiresAt: grantExpiresAt,
      accessToken: 'stale-token',
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      accessRequest: {
        name: 'Chang Liu',
        organization: { name: 'Acme Security' },
      },
      ndaAgreement: null,
    });
    // This caller loses: the guarded write matches zero rows because a
    // concurrent reclaim rotated first.
    mockDb.trustAccessGrant.updateMany.mockResolvedValue({ count: 0 });
    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      accessToken: 'winner-token',
      accessTokenExpiresAt: grantExpiresAt,
      expiresAt: grantExpiresAt,
    });
    const builderSpy = jest.spyOn(
      grantTokens as unknown as {
        buildPublicPortalAccessUrl: (params: {
          accessToken: string;
        }) => Promise<string>;
      },
      'buildPublicPortalAccessUrl',
    );
    builderSpy.mockImplementationOnce(
      async (params) =>
        `https://portal.example.com/access/${params.accessToken}`,
    );

    await service.reclaimAccess('acme-security', 'chang.liu@client.com');

    expect(mockDb.trustAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tag_1', accessToken: 'stale-token' },
      data: expect.objectContaining({ accessToken: expect.any(String) }),
    });
    // The emailed link carries the winner's token, not this caller's
    // overwritten mint — the first email stays valid.
    expect(emailService.sendAccessReclaimEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        accessLink: 'https://portal.example.com/access/winner-token',
      }),
    );
  });
});

describe('TrustAccessService access request notification', () => {
  const emailService = {
    sendAccessRequestNotification: jest.fn(),
  };
  const { intakeService } = createAccessService({ email: emailService });

  const ORIGINAL_BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BETTER_AUTH_URL = 'https://app.gideondefender.com';
  });

  afterAll(() => {
    process.env.BETTER_AUTH_URL = ORIGINAL_BETTER_AUTH_URL;
  });

  it('points the review button at the access requests page, not the trust overview', async () => {
    // contactEmail present -> single recipient, no member fallback lookup.
    mockDb.trust.findUnique.mockResolvedValue({
      contactEmail: 'owner@acme.com',
    });

    const dto: CreateAccessRequestDto = {
      name: 'Jane Doe',
      email: 'jane@example.com',
    };

    await intakeService['sendAccessRequestNotificationToOrg'](
      'org_123',
      'tar_456',
      'Acme Inc',
      dto,
    );

    expect(emailService.sendAccessRequestNotification).toHaveBeenCalledTimes(1);
    // Must deep-link to the pending requests list, NOT /org_123/trust (the
    // trust portal settings/overview page).
    expect(emailService.sendAccessRequestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewUrl:
          'https://app.gideondefender.com/org_123/trust/access-requests',
      }),
    );
  });
});

describe('TrustAccessService resendNda token rotation', () => {
  const emailService = {
    sendNdaSigningEmail: jest.fn(),
  };
  const { service } = createAccessService({ email: emailService });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.trustAccessRequest.findFirst.mockResolvedValue({
      id: 'tar_1',
      status: 'approved',
      email: 'jane@example.com',
      name: 'Jane Doe',
      organization: { name: 'Acme Security' },
      ndaAgreements: [{ id: 'tna_1', signToken: 'old-token' }],
    });
    mockDb.trustNDAAgreement.update.mockResolvedValue({});
  });

  it('rotates the sign token instead of extending the old link', async () => {
    await service.resendNda('org_1', 'tar_1');

    expect(mockDb.trustNDAAgreement.update).toHaveBeenCalledWith({
      where: { id: 'tna_1' },
      data: expect.objectContaining({
        signToken: expect.any(String),
        signTokenExpiresAt: expect.any(Date),
      }),
    });
    const updateData = mockDb.trustNDAAgreement.update.mock.calls[0][0]
      .data as {
      signToken: string;
    };
    expect(updateData.signToken).not.toBe('old-token');
    expect(emailService.sendNdaSigningEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ndaSigningLink: expect.stringContaining(updateData.signToken),
      }),
    );
  });
});

describe('TrustPublicService draft portal gating', () => {
  const service = new TrustPublicService(
    {} as unknown as TrustCustomFrameworkService,
  );
  const catalogService = new TrustPublicCatalogService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hides vendors for a draft portal', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(catalogService.getPublicVendors('acme')).resolves.toEqual([]);
    expect(mockDb.vendor.findMany).not.toHaveBeenCalled();
  });

  it('hides custom links for a draft portal', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(service.getPublicCustomLinks('acme')).resolves.toEqual([]);
  });

  it('hides the overview for a draft portal', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      overviewTitle: 'Title',
      overviewContent: 'Content',
      showOverview: true,
      status: 'draft',
    });

    await expect(service.getPublicOverview('acme')).resolves.toBeNull();
  });

  it('hides the favicon for a draft portal', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      favicon: 'org_1/trust/favicon/icon.png',
      status: 'draft',
    });

    await expect(service.getPublicFavicon('acme')).resolves.toBeNull();
  });
});

describe('TrustPublicService organizationId fallback', () => {
  const service = new TrustPublicService(
    {} as unknown as TrustCustomFrameworkService,
  );
  const catalogService = new TrustPublicCatalogService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves vendors by organizationId when the friendlyUrl misses', async () => {
    mockDb.trust.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ organizationId: 'org_1', status: 'published' });
    mockDb.vendor.findMany.mockResolvedValue([]);
    mockDb.globalVendors.findMany.mockResolvedValue([]);

    await expect(catalogService.getPublicVendors('org_1')).resolves.toEqual([]);

    expect(mockDb.trust.findUnique).toHaveBeenNthCalledWith(1, {
      where: { friendlyUrl: 'org_1' },
      select: { organizationId: true, status: true },
    });
    expect(mockDb.trust.findUnique).toHaveBeenNthCalledWith(2, {
      where: { organizationId: 'org_1' },
      select: { organizationId: true, status: true },
    });
    expect(mockDb.vendor.findMany).toHaveBeenCalled();
  });

  it('resolves custom links by organizationId when the friendlyUrl misses', async () => {
    mockDb.trust.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ organizationId: 'org_1', status: 'published' });
    mockDb.trustCustomLink.findMany.mockResolvedValue([]);

    await expect(service.getPublicCustomLinks('org_1')).resolves.toEqual([]);

    expect(mockDb.trust.findUnique).toHaveBeenNthCalledWith(2, {
      where: { organizationId: 'org_1' },
      select: { organizationId: true, status: true },
    });
  });

  it('resolves the overview by organizationId when the friendlyUrl misses', async () => {
    mockDb.trust.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      overviewTitle: 'Title',
      overviewContent: 'Content',
      showOverview: true,
      status: 'published',
    });

    await expect(service.getPublicOverview('org_1')).resolves.toEqual({
      title: 'Title',
      content: 'Content',
    });
  });
});

describe('TrustAccessService getNdaByToken signed-branch rotation', () => {
  const { service } = createAccessService({
    ndaPdf: { getSignedUrl: jest.fn() },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rotates an expired link token instead of handing out the stale one', async () => {
    const grantExpiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      id: 'tna_1',
      organizationId: 'org_1',
      status: 'signed',
      signToken: 'sign-token',
      signTokenExpiresAt: grantExpiresAt,
      accessRequest: {
        name: 'Chang Liu',
        email: 'chang.liu@client.com',
        organization: { name: 'Acme Security' },
      },
      grant: {
        id: 'tag_1',
        status: 'active',
        accessToken: 'stale-token',
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        expiresAt: grantExpiresAt,
      },
    });
    mockDb.trust.findUnique.mockResolvedValue({
      domain: null,
      domainVerified: false,
      friendlyUrl: 'acme',
      favicon: null,
      securityQuestionnaireEnabled: true,
    });
    mockDb.trustAccessGrant.updateMany.mockImplementation(() =>
      Promise.resolve({ count: 1 }),
    );

    const result = await service.getNdaByToken('sign-token');

    expect(result.status).toBe('signed');
    expect(mockDb.trustAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tag_1', accessToken: 'stale-token' },
      data: expect.objectContaining({ accessToken: expect.any(String) }),
    });
    const rotated = (
      mockDb.trustAccessGrant.updateMany.mock.calls[0][0] as {
        data: { accessToken: string };
      }
    ).data.accessToken;
    expect(rotated).not.toBe('stale-token');
    expect(result.portalUrl).toContain(rotated);
  });

  it('stays signed after the 7-day sign window lapses on a live grant', async () => {
    const grantExpiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      id: 'tna_1',
      organizationId: 'org_1',
      status: 'signed',
      signToken: 'sign-token',
      signTokenExpiresAt: new Date(Date.now() - 1000),
      accessRequest: {
        name: 'Chang Liu',
        email: 'chang.liu@client.com',
        organization: { name: 'Acme Security' },
      },
      grant: {
        id: 'tag_1',
        status: 'active',
        accessToken: 'live-token',
        accessTokenExpiresAt: grantExpiresAt,
        expiresAt: grantExpiresAt,
      },
    });
    mockDb.trust.findUnique.mockResolvedValue({
      domain: null,
      domainVerified: false,
      friendlyUrl: 'acme',
      favicon: null,
      securityQuestionnaireEnabled: true,
    });

    const result = await service.getNdaByToken('sign-token');

    expect(result.status).toBe('signed');
    // Live link token: no rotation write needed.
    expect(mockDb.trustAccessGrant.updateMany).not.toHaveBeenCalled();
  });
});

describe('TrustAccessService signNda idempotent branch guards', () => {
  const ndaPdfService = {
    generateNdaPdf: jest.fn(),
    uploadNdaPdf: jest.fn(),
    getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/nda.pdf'),
  };
  const { service, ndaSignService } = createAccessService({
    ndaPdf: ndaPdfService,
  });
  jest
    .spyOn(
      ndaSignService as unknown as {
        buildPublicPortalAccessUrl: () => Promise<string>;
      },
      'buildPublicPortalAccessUrl',
    )
    .mockResolvedValue('https://portal.example.com/access/token');
  jest
    .spyOn(
      ndaSignService as unknown as {
        buildPublicPortalBaseUrl: () => Promise<string>;
      },
      'buildPublicPortalBaseUrl',
    )
    .mockResolvedValue('https://portal.example.com/acme');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockSignedNda(
    grant: unknown,
    pdfSignedKey: string | null = 'org_1/nda/nda_1.pdf',
  ) {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      id: 'nda_1',
      organizationId: 'org_1',
      status: 'signed',
      signToken: 'sign-token',
      signTokenExpiresAt: new Date(Date.now() + 86_400_000),
      pdfSignedKey,
      accessRequest: {
        name: 'Chang Liu',
        email: 'chang.liu@client.com',
        organization: { name: 'Acme Security' },
      },
      grant,
    });
  }

  it('does not rotate the token for a revoked grant', async () => {
    mockSignedNda({
      id: 'tag_1',
      status: 'revoked',
      accessToken: 'old-token',
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const result = await service.signNda(
      'sign-token',
      'Chang Liu',
      'chang.liu@client.com',
      '1.2.3.4',
      'jest-agent',
    );

    expect(mockDb.trustAccessGrant.updateMany).not.toHaveBeenCalled();
    expect(result.portalUrl).toBe('https://portal.example.com/acme');
    expect(result.grant).toMatchObject({ accessToken: 'old-token' });
  });

  it('pairs a rotated token with its fresh expiry on replay', async () => {
    const grantExpiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    mockSignedNda({
      id: 'tag_1',
      status: 'active',
      accessToken: 'old-token',
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      expiresAt: grantExpiresAt,
    });

    const result = await service.signNda(
      'sign-token',
      'Chang Liu',
      'chang.liu@client.com',
      '1.2.3.4',
      'jest-agent',
    );

    expect(mockDb.trustAccessGrant.updateMany).toHaveBeenCalledTimes(1);
    expect(result.grant.accessToken).not.toBe('old-token');
    expect(result.grant).toMatchObject({
      accessTokenExpiresAt: grantExpiresAt,
    });
  });

  it('heals a missing signed PDF on replay instead of serving null forever', async () => {
    const liveTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
    mockSignedNda(
      {
        id: 'tag_1',
        status: 'active',
        accessToken: 'live-token',
        accessTokenExpiresAt: liveTokenExpiry,
        expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      },
      null,
    );
    ndaPdfService.generateNdaPdf.mockResolvedValue(Buffer.from('pdf-bytes'));
    ndaPdfService.uploadNdaPdf.mockResolvedValue('org_1/nda/nda_1.pdf');

    const result = await service.signNda(
      'sign-token',
      'Chang Liu',
      'chang.liu@client.com',
      '1.2.3.4',
      'jest-agent',
    );

    expect(ndaPdfService.generateNdaPdf).toHaveBeenCalledTimes(1);
    expect(ndaPdfService.uploadNdaPdf).toHaveBeenCalledTimes(1);
    expect(mockDb.trustNDAAgreement.update).toHaveBeenCalledWith({
      where: { id: 'nda_1' },
      data: { pdfSignedKey: 'org_1/nda/nda_1.pdf' },
    });
    expect(result.pdfDownloadUrl).toBe('https://s3.example.com/nda.pdf');
  });

  it('retries a failing PDF upload, then fails loudly instead of losing the record', async () => {
    const liveTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
    mockSignedNda(
      {
        id: 'tag_1',
        status: 'active',
        accessToken: 'live-token',
        accessTokenExpiresAt: liveTokenExpiry,
        expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      },
      null,
    );
    ndaPdfService.generateNdaPdf.mockResolvedValue(Buffer.from('pdf-bytes'));
    ndaPdfService.uploadNdaPdf.mockRejectedValue(new Error('s3 down'));

    await expect(
      service.signNda(
        'sign-token',
        'Chang Liu',
        'chang.liu@client.com',
        '1.2.3.4',
        'jest-agent',
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(ndaPdfService.uploadNdaPdf).toHaveBeenCalledTimes(3);
  });
});

describe('TrustAccessService token-gated reads tenant scoping', () => {
  const { service } = createAccessService({});

  const futureDate = () => new Date(Date.now() + 60 * 60 * 1000);

  function mockLiveGrant() {
    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      id: 'tag_1',
      status: 'active',
      expiresAt: futureDate(),
      accessTokenExpiresAt: futureDate(),
      accessToken: 'tok_abc',
      subjectEmail: 'alice@example.com',
      accessRequest: {
        organizationId: 'org_1',
        name: 'Alice',
        email: 'alice@example.com',
        organization: { name: 'Acme Security' },
      },
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an unknown token', async () => {
    mockDb.trustAccessGrant.findUnique.mockResolvedValue(null);

    await expect(
      service.getPoliciesByAccessToken('bogus'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a revoked or expired grant', async () => {
    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      id: 'tag_1',
      status: 'revoked',
      expiresAt: futureDate(),
      accessTokenExpiresAt: futureDate(),
      accessRequest: { organizationId: 'org_1' },
    });
    await expect(
      service.getPoliciesByAccessToken('tok_abc'),
    ).rejects.toBeInstanceOf(BadRequestException);

    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      id: 'tag_1',
      status: 'active',
      expiresAt: new Date(Date.now() - 1000),
      accessTokenExpiresAt: futureDate(),
      accessRequest: { organizationId: 'org_1' },
    });
    await expect(
      service.getTrustDocumentsByAccessToken('tok_abc'),
    ).rejects.toThrow('Access grant has expired');
  });

  it('rejects an expired link token on a live grant', async () => {
    mockDb.trustAccessGrant.findUnique.mockResolvedValue({
      id: 'tag_1',
      status: 'active',
      expiresAt: futureDate(),
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      accessRequest: { organizationId: 'org_1' },
    });

    await expect(
      service.getComplianceResourcesByAccessToken('tok_abc'),
    ).rejects.toThrow('Access token has expired');
  });

  it('scopes policy reads to the grant organization', async () => {
    mockLiveGrant();
    mockDb.policy.findMany.mockResolvedValue([]);

    await service.getPoliciesByAccessToken('tok_abc');

    expect(mockDb.policy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org_1' }),
      }),
    );
  });

  it('scopes document reads to active docs of the grant organization', async () => {
    mockLiveGrant();
    mockDb.trustDocument.findMany.mockResolvedValue([]);

    await service.getTrustDocumentsByAccessToken('tok_abc');

    expect(mockDb.trustDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org_1',
          isActive: true,
        }),
      }),
    );
  });

  it('rejects a document from another organization', async () => {
    mockLiveGrant();
    mockDb.trustDocument.findFirst.mockResolvedValue(null);

    await expect(
      service.getTrustDocumentUrlByAccessToken('tok_abc', 'tdoc_other'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockDb.trustDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'tdoc_other',
          organizationId: 'org_1',
        }),
      }),
    );
  });
});
