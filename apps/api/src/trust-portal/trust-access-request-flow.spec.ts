import { BadRequestException } from '@nestjs/common';
import { db } from '@db';
import { AttachmentsService } from '../attachments/attachments.service';
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
import { TrustCustomFrameworkService } from './trust-custom-framework.service';
import { TrustPublicService } from './trust-public.service';
import { TrustEmailService } from './email.service';
import { NdaPdfService } from './nda-pdf.service';
import { PolicyPdfRendererService } from './policy-pdf-renderer.service';

jest.mock('@db', () => ({
  db: {
    trust: { findUnique: jest.fn(), findFirst: jest.fn() },
    trustAccessGrant: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    trustAccessRequest: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
    },
    member: { findMany: jest.fn(), findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
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
    soc2_type1: 'soc2_type1',
    soc2_type2: 'soc2_type2',
    soc3: 'soc3',
    iso_27001: 'iso_27001',
    iso_42001: 'iso_42001',
    iso_9001: 'iso_9001',
    gdpr: 'gdpr',
    hipaa: 'hipaa',
    pci_dss: 'pci_dss',
    nen_7510: 'nen_7510',
    pipeda: 'pipeda',
    ccpa: 'ccpa',
    dora: 'dora',
    nis_2: 'nis_2',
    hitrust_csf: 'hitrust_csf',
    nist_csf: 'nist_csf',
    nist_800_53: 'nist_800_53',
  },
}));

type MockFn = jest.Mock;

const mockDb = db as unknown as {
  trust: { findUnique: MockFn; findFirst: MockFn };
  trustAccessGrant: { findFirst: MockFn; updateMany: MockFn };
  trustAccessRequest: {
    findFirst: MockFn;
    create: MockFn;
    updateMany: MockFn;
    findUniqueOrThrow: MockFn;
    delete: MockFn;
  };
  member: { findMany: MockFn; findFirst: MockFn };
  auditLog: { create: MockFn };
  $transaction: MockFn;
};

const publishedTrust = {
  organizationId: 'org_1',
  friendlyUrl: 'acme',
  organization: { name: 'Acme' },
  status: 'published',
};

function makeService(emailService?: { [key: string]: MockFn }) {
  const email = {
    sendAccessReclaimEmail: jest.fn(),
    sendAccessRequestNotification: jest.fn(),
    ...emailService,
  };
  const emailStub = email as unknown as TrustEmailService;
  const ndaPdfService = {} as unknown as NdaPdfService;
  const attachmentsService = {} as unknown as AttachmentsService;
  const trustPublicService = new TrustPublicService(
    {} as unknown as TrustCustomFrameworkService,
  );
  const grantReads = new TrustGrantReadsService(
    ndaPdfService,
    trustPublicService,
  );
  const grantTokens = new TrustGrantTokenService(emailStub);
  const ndaService = new TrustNdaService(
    ndaPdfService,
    trustPublicService,
    grantTokens,
    new TrustNdaPreviewService(ndaPdfService, attachmentsService),
  );
  const service = new TrustAccessService(
    grantReads,
    grantTokens,
    new TrustDocumentDownloadService(grantReads),
    new TrustResourceDownloadService(
      attachmentsService,
      ndaPdfService,
      grantReads,
    ),
    new TrustPolicyDownloadService(
      attachmentsService,
      {} as unknown as PolicyPdfRendererService,
      ndaPdfService,
      grantReads,
    ),
    new TrustPolicyFileDownloadService(
      attachmentsService,
      {} as unknown as PolicyPdfRendererService,
      ndaPdfService,
      grantReads,
    ),
    ndaService,
    new TrustNdaSignService(ndaPdfService, emailStub, grantTokens, ndaService),
    new TrustRequestIntakeService(emailStub, grantTokens),
    new TrustRequestApprovalService(emailStub),
    new TrustRequestModerationService(),
    new TrustRequestResendService(emailStub, grantTokens),
  );
  return { service, email };
}

const dto = {
  name: 'Ada Lovelace',
  email: 'User@Example.com',
  company: 'Example',
  jobTitle: 'Engineer',
  purpose: 'Review',
  requestedDurationDays: 30,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.trust.findUnique.mockResolvedValue(publishedTrust);
  mockDb.trust.findFirst.mockResolvedValue(null);
  mockDb.member.findMany.mockResolvedValue([]);
});

describe('createAccessRequest enumeration resistance', () => {
  it('returns the generic response for an existing grant without leaking details', async () => {
    const { service, email } = makeService();
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      id: 'grant_1',
      expiresAt: new Date(Date.now() + 86400000),
      accessToken: 'tok',
      accessTokenExpiresAt: new Date(Date.now() + 86400000),
      accessRequest: { name: 'Ada', organization: { name: 'Acme' } },
    });

    const result = await service.createAccessRequest(
      'acme',
      { ...dto },
      undefined,
      undefined,
    );

    expect(result).toEqual({
      status: 'under_review',
      message: 'Access request submitted for review',
    });
    expect(result).not.toHaveProperty('already_approved');
    expect(result).not.toHaveProperty('grant');
    expect(email.sendAccessReclaimEmail).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'user@example.com' }),
    );
  });

  it('matches grants case-insensitively', async () => {
    const { service } = makeService();
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      id: 'grant_1',
      expiresAt: new Date(Date.now() + 86400000),
      accessToken: 'tok',
      accessTokenExpiresAt: new Date(Date.now() + 86400000),
      accessRequest: { name: 'Ada', organization: { name: 'Acme' } },
    });

    await service.createAccessRequest(
      'acme',
      { ...dto, email: 'USER@EXAMPLE.COM' },
      undefined,
      undefined,
    );

    expect(mockDb.trustAccessGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subjectEmail: 'user@example.com' }),
      }),
    );
  });

  it('returns the generic response for a pending request instead of 400', async () => {
    const { service } = makeService();
    mockDb.trustAccessGrant.findFirst.mockResolvedValue(null);
    mockDb.trustAccessRequest.findFirst.mockResolvedValue({
      id: 'req_pending',
    });

    const result = await service.createAccessRequest(
      'acme',
      { ...dto },
      undefined,
      undefined,
    );

    expect(result).toEqual({
      status: 'under_review',
      message: 'Access request submitted for review',
    });
    expect(mockDb.trustAccessRequest.create).not.toHaveBeenCalled();
  });

  it('stores the normalized email for new requests', async () => {
    const { service } = makeService();
    mockDb.trustAccessGrant.findFirst.mockResolvedValue(null);
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(null);
    mockDb.trustAccessRequest.create.mockResolvedValue({ id: 'req_1' });

    await service.createAccessRequest(
      'acme',
      { ...dto, email: '  User@Example.com ' },
      undefined,
      undefined,
    );

    expect(mockDb.trustAccessRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'user@example.com' }),
      }),
    );
  });

  it('deletes its own row when a concurrent submit wins the race', async () => {
    const { service, email } = makeService();
    mockDb.trustAccessGrant.findFirst.mockResolvedValue(null);
    // First read (pre-create check) sees nothing; the post-create check
    // finds the winner's older row.
    mockDb.trustAccessRequest.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'req_old' });
    mockDb.trustAccessRequest.create.mockResolvedValue({
      id: 'req_new',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    mockDb.trustAccessRequest.delete.mockResolvedValue({ id: 'req_new' });

    const result = await service.createAccessRequest(
      'acme',
      { ...dto },
      undefined,
      undefined,
    );

    expect(result).toEqual({
      status: 'under_review',
      message: 'Access request submitted for review',
    });
    expect(mockDb.trustAccessRequest.delete).toHaveBeenCalledWith({
      where: { id: 'req_new' },
    });
    expect(email.sendAccessRequestNotification).not.toHaveBeenCalled();
  });
});

describe('denyRequest atomic transition', () => {
  it('rejects when another reviewer already processed the request', async () => {
    const { service } = makeService();
    mockDb.trustAccessRequest.findFirst.mockResolvedValue({
      id: 'req_1',
      email: 'user@example.com',
      status: 'under_review',
    });
    mockDb.member.findFirst.mockResolvedValue({
      id: 'mem_1',
      userId: 'user_1',
    });
    mockDb.trustAccessRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.denyRequest('org_1', 'req_1', { reason: 'nope' }, 'mem_1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});
