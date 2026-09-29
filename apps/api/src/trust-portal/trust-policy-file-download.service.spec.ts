import { NotFoundException } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PDFDocument } from 'pdf-lib';
import { db } from '@db';
import { getSignedUrl, s3Client } from '../app/s3';
import { AttachmentsService } from '../attachments/attachments.service';
import { PolicyPdfRendererService } from './policy-pdf-renderer.service';
import { NdaPdfService } from './nda-pdf.service';
import { TrustPublicService } from './trust-public.service';
import { TrustGrantReadsService } from './trust-grant-reads.service';
import { TrustPolicyFileDownloadService } from './trust-policy-file-download.service';

jest.mock('@db', () => ({
  db: {
    trustAccessGrant: { findUnique: jest.fn() },
    policy: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

jest.mock('../app/s3', () => ({
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  s3Client: { send: jest.fn() },
  getSignedUrl: jest.fn(),
}));

const mockDb = db as unknown as {
  trustAccessGrant: { findUnique: jest.Mock };
  policy: { findMany: jest.Mock; findFirst: jest.Mock };
};

const mockSend = s3Client.send as unknown as jest.Mock;
const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<
  typeof getSignedUrl
>;

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
      name: 'Ada Lovelace',
      organization: { name: 'Acme', primaryColor: null },
    },
  };
}

async function minimalPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  return Buffer.from(await doc.save());
}

function createService() {
  const attachmentsService = {
    uploadToS3: jest.fn().mockResolvedValue('s3-key'),
    getPresignedDownloadUrl: jest
      .fn()
      .mockResolvedValue('https://signed-url/file.pdf'),
    getPresignedDownloadUrlWithFilename: jest
      .fn()
      .mockResolvedValue('https://signed-url/named.pdf'),
    getObjectBuffer: jest.fn(),
  } as unknown as AttachmentsService;
  const pdfRendererService = {
    renderPoliciesPdfBuffer: jest.fn(),
  } as unknown as PolicyPdfRendererService;
  const ndaPdfService = {
    watermarkExistingPdf: jest
      .fn()
      .mockImplementation((buffer: Buffer) => Promise.resolve(buffer)),
  } as unknown as NdaPdfService;
  const grantReads = new TrustGrantReadsService(
    ndaPdfService,
    {} as unknown as TrustPublicService,
  );
  const service = new TrustPolicyFileDownloadService(
    attachmentsService,
    pdfRendererService,
    ndaPdfService,
    grantReads,
  );
  return { service, attachmentsService, pdfRendererService, ndaPdfService };
}

function contentPolicy(id: string, name: string) {
  return {
    id,
    name,
    content: { text: 'policy content' },
    pdfUrl: null,
    currentVersion: null,
  };
}

describe('TrustPolicyFileDownloadService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDb.trustAccessGrant.findUnique.mockResolvedValue(activeGrant());
    mockGetSignedUrl.mockResolvedValue('https://signed-url/policies.zip');
    mockSend.mockImplementation(() => Promise.resolve({}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('downloadPolicyByAccessToken', () => {
    it('throws NotFound for an unknown policy', async () => {
      mockDb.policy.findFirst.mockResolvedValue(null);
      const { service } = createService();

      await expect(
        service.downloadPolicyByAccessToken('token', 'pol_missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns a sanitized filename for the watermarked PDF', async () => {
      mockDb.policy.findFirst.mockResolvedValue(
        contentPolicy('pol_1', 'A/B "quoted" Policy'),
      );
      const rendered = await minimalPdf();
      const { service, attachmentsService, pdfRendererService } =
        createService();
      (pdfRendererService.renderPoliciesPdfBuffer as jest.Mock).mockReturnValue(
        rendered,
      );

      const result = await service.downloadPolicyByAccessToken(
        'token',
        'pol_1',
      );

      expect(result.fileName).toBe('ab_quoted_policy.pdf');
      expect(
        attachmentsService.getPresignedDownloadUrlWithFilename,
      ).toHaveBeenCalledWith('s3-key', 'ab_quoted_policy.pdf');
      expect(result.signedUrl).toBe('https://signed-url/named.pdf');
    });
  });

  describe('downloadAllPoliciesAsZipByAccessToken', () => {
    it('throws NotFound when no published policies exist', async () => {
      mockDb.policy.findMany.mockResolvedValue([]);
      const { service } = createService();

      await expect(
        service.downloadAllPoliciesAsZipByAccessToken('token'),
      ).rejects.toThrow('No published policies available');
    });

    it('zips every policy and returns a signed URL with the count', async () => {
      mockDb.policy.findMany.mockResolvedValue([
        contentPolicy('pol_1', 'Security Policy'),
        contentPolicy('pol_2', 'Security Policy'),
      ]);
      const rendered = await minimalPdf();
      const { service, pdfRendererService } = createService();
      (pdfRendererService.renderPoliciesPdfBuffer as jest.Mock).mockReturnValue(
        rendered,
      );

      const result =
        await service.downloadAllPoliciesAsZipByAccessToken('token');

      expect(pdfRendererService.renderPoliciesPdfBuffer).toHaveBeenCalledTimes(
        2,
      );
      expect(result.policyCount).toBe(2);
      expect(result.name).toContain('All Policies (ZIP)');
      expect(result.downloadUrl).toBe('https://signed-url/policies.zip');
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      const getCommand = mockGetSignedUrl.mock.calls[0]?.[1] as unknown as {
        input: { Key?: string };
      };
      expect(getCommand.input.Key).toBe(
        'org_1/trust_policy_downloads/grant_1/policies.zip',
      );
    });

    it('streams uploads through the fixed per-grant key', async () => {
      mockDb.policy.findMany.mockResolvedValue([
        contentPolicy('pol_1', 'Security Policy'),
      ]);
      const rendered = await minimalPdf();
      const { service, pdfRendererService } = createService();
      (pdfRendererService.renderPoliciesPdfBuffer as jest.Mock).mockReturnValue(
        rendered,
      );
      const putKeys: Array<string | undefined> = [];
      mockSend.mockImplementation((command: unknown) => {
        if (command instanceof PutObjectCommand) {
          putKeys.push(
            (command as unknown as { input: { Key?: string } }).input.Key,
          );
        }
        return Promise.resolve({});
      });

      await service.downloadAllPoliciesAsZipByAccessToken('token');

      expect(putKeys).toEqual([
        'org_1/trust_policy_downloads/grant_1/policies.zip',
      ]);
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    });
  });
});
