import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { TrustFramework, db } from '@db';
import { s3Client } from '../app/s3';
import { AttachmentsService } from '../attachments/attachments.service';
import { NdaPdfService } from './nda-pdf.service';
import { TrustPublicService } from './trust-public.service';
import { TrustGrantReadsService } from './trust-grant-reads.service';
import { TrustResourceDownloadService } from './trust-resource-download.service';

jest.mock('@db', () => ({
  db: {
    trustAccessGrant: { findUnique: jest.fn() },
    trustResource: { findUnique: jest.fn() },
    trust: { findUnique: jest.fn(), update: jest.fn() },
  },
  TrustFramework: {
    soc2_type1: 'soc2_type1',
  },
}));

jest.mock('../app/s3', () => ({
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  s3Client: { send: jest.fn() },
  getSignedUrl: jest.fn(),
}));

const mockDb = db as unknown as {
  trustAccessGrant: { findUnique: jest.Mock };
  trustResource: { findUnique: jest.Mock };
  trust: { findUnique: jest.Mock; update: jest.Mock };
};

const mockSend = s3Client.send as unknown as jest.Mock;

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

function createService() {
  const attachmentsService = {
    uploadToS3: jest.fn().mockResolvedValue('s3-key'),
    getPresignedDownloadUrl: jest
      .fn()
      .mockResolvedValue('https://signed-url/cert.pdf'),
  } as unknown as AttachmentsService;
  const ndaPdfService = {
    watermarkExistingPdf: jest
      .fn()
      .mockImplementation((buffer: Buffer) => Promise.resolve(buffer)),
  } as unknown as NdaPdfService;
  const grantReads = new TrustGrantReadsService(
    ndaPdfService,
    {} as unknown as TrustPublicService,
  );
  const service = new TrustResourceDownloadService(
    attachmentsService,
    ndaPdfService,
    grantReads,
  );
  return { service, attachmentsService, ndaPdfService };
}

describe('TrustResourceDownloadService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.trustAccessGrant.findUnique.mockResolvedValue(activeGrant());
    mockDb.trust.findUnique.mockResolvedValue({ soc2type1: true });
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: Readable.from([Buffer.from('pdf-bytes')]),
        });
      }
      return Promise.resolve({});
    });
  });

  describe('getComplianceResourceUrlByAccessToken', () => {
    it('rejects an unknown framework', async () => {
      const { service } = createService();

      await expect(
        service.getComplianceResourceUrlByAccessToken(
          'token',
          'bogus' as TrustFramework,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound when no certificate was uploaded', async () => {
      mockDb.trustResource.findUnique.mockResolvedValue(null);
      const { service } = createService();

      await expect(
        service.getComplianceResourceUrlByAccessToken(
          'token',
          TrustFramework.soc2_type1,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('watermarks, re-uploads, and signs the stored certificate', async () => {
      mockDb.trustResource.findUnique.mockResolvedValue({
        s3Key: 'org_1/certs/soc2.pdf',
        fileName: 'soc2.pdf',
      });
      const { service, attachmentsService, ndaPdfService } = createService();

      const result = await service.getComplianceResourceUrlByAccessToken(
        'token',
        TrustFramework.soc2_type1,
      );

      expect(ndaPdfService.watermarkExistingPdf).toHaveBeenCalledTimes(1);
      expect(attachmentsService.uploadToS3).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        signedUrl: 'https://signed-url/cert.pdf',
        fileName: 'soc2.pdf',
        fileSize: Buffer.from('pdf-bytes').length,
      });
    });

    it('throws when S3 returns no body', async () => {
      mockDb.trustResource.findUnique.mockResolvedValue({
        s3Key: 'org_1/certs/soc2.pdf',
        fileName: 'soc2.pdf',
      });
      mockSend.mockImplementation((command: unknown) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({ Body: undefined });
        }
        return Promise.resolve({});
      });
      const { service } = createService();

      await expect(
        service.getComplianceResourceUrlByAccessToken(
          'token',
          TrustFramework.soc2_type1,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getCustomComplianceResourceUrlByAccessToken', () => {
    it('throws NotFound when no custom certificate was uploaded', async () => {
      mockDb.trustResource.findUnique.mockResolvedValue(null);
      const { service } = createService();

      await expect(
        service.getCustomComplianceResourceUrlByAccessToken('token', 'cfrm_1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('signs the stored custom certificate', async () => {
      mockDb.trustResource.findUnique.mockResolvedValue({
        s3Key: 'org_1/certs/custom.pdf',
        fileName: 'custom.pdf',
      });
      const { service } = createService();

      const result = await service.getCustomComplianceResourceUrlByAccessToken(
        'token',
        'cfrm_1',
      );

      expect(result.signedUrl).toBe('https://signed-url/cert.pdf');
      expect(result.fileName).toBe('custom.pdf');
    });
  });
});
