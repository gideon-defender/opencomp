import { NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { getSignedUrl } from '../app/s3';
import { NdaPdfService } from './nda-pdf.service';
import { TrustPublicService } from './trust-public.service';
import { TrustGrantReadsService } from './trust-grant-reads.service';

jest.mock('@db', () => ({
  db: {
    trustAccessGrant: { findUnique: jest.fn() },
    trustDocument: { findFirst: jest.fn() },
  },
}));

jest.mock('../app/s3', () => ({
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  s3Client: { send: jest.fn() },
  getSignedUrl: jest.fn(),
}));

const mockDb = db as unknown as {
  trustAccessGrant: { findUnique: jest.Mock };
  trustDocument: { findFirst: jest.Mock };
};

const mockGetSignedUrl = getSignedUrl as unknown as jest.Mock;

function activeGrant() {
  const future = new Date(Date.now() + 86_400_000);
  return {
    id: 'grant_1',
    status: 'active',
    expiresAt: future,
    accessToken: 'token',
    accessTokenExpiresAt: future,
    subjectEmail: 'ada@company.com',
    accessRequest: {
      organizationId: 'org_1',
      organization: { name: 'Acme' },
    },
  };
}

function createService() {
  return new TrustGrantReadsService(
    {} as unknown as NdaPdfService,
    {} as unknown as TrustPublicService,
  );
}

describe('TrustGrantReadsService.getTrustDocumentUrlByAccessToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.trustAccessGrant.findUnique.mockResolvedValue(activeGrant());
    mockDb.trustDocument.findFirst.mockResolvedValue({
      name: 'Q4 Report.pdf',
      s3Key: 'org_1/docs/a.pdf',
    });
    mockGetSignedUrl.mockResolvedValue('https://signed-url/doc.pdf');
  });

  it('keeps the file extension in the download filename', async () => {
    let disposition: string | undefined;
    mockGetSignedUrl.mockImplementation(
      (...args: unknown[]): Promise<string> => {
        const command = args[1] as {
          input: { ResponseContentDisposition?: string };
        };
        disposition = command.input.ResponseContentDisposition;
        return Promise.resolve('https://signed-url/doc.pdf');
      },
    );
    const service = createService();

    const result = await service.getTrustDocumentUrlByAccessToken(
      'token',
      'doc_1',
    );

    expect(disposition).toBe('attachment; filename="q4_report.pdf"');
    expect(result).toEqual({
      signedUrl: 'https://signed-url/doc.pdf',
      fileName: 'Q4 Report.pdf',
    });
  });

  it('throws NotFound when the document belongs to another organization', async () => {
    mockDb.trustDocument.findFirst.mockResolvedValue(null);
    const service = createService();

    await expect(
      service.getTrustDocumentUrlByAccessToken('token', 'doc_other_org'),
    ).rejects.toThrow(NotFoundException);

    expect(mockDb.trustDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'doc_other_org',
          organizationId: 'org_1',
        }),
      }),
    );
  });
});
