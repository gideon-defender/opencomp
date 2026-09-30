import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { PassThrough, Readable } from 'stream';
import { db } from '@db';
import { getSignedUrl, s3Client } from '../app/s3';
import { NdaPdfService } from './nda-pdf.service';
import { TrustPublicService } from './trust-public.service';
import { TrustGrantReadsService } from './trust-grant-reads.service';
import { TrustDocumentDownloadService } from './trust-document-download.service';

jest.mock('@db', () => ({
  db: {
    trustAccessGrant: { findUnique: jest.fn() },
    trustDocument: { findMany: jest.fn() },
  },
}));

jest.mock('../app/s3', () => ({
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  s3Client: { send: jest.fn() },
  getSignedUrl: jest.fn(),
}));

const mockDb = db as unknown as {
  trustAccessGrant: { findUnique: jest.Mock };
  trustDocument: { findMany: jest.Mock };
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

function createService() {
  const grantReads = new TrustGrantReadsService(
    {} as unknown as NdaPdfService,
    {} as unknown as TrustPublicService,
  );
  return new TrustDocumentDownloadService(grantReads);
}

describe('TrustDocumentDownloadService.downloadAllTrustDocumentsByAccessToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.trustAccessGrant.findUnique.mockResolvedValue(activeGrant());
    mockGetSignedUrl.mockResolvedValue('https://signed-url/documents.zip');
  });

  it('throws NotFound when the token is unknown', async () => {
    mockDb.trustAccessGrant.findUnique.mockResolvedValue(null);
    const service = createService();

    await expect(
      service.downloadAllTrustDocumentsByAccessToken('bad'),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFound when no active documents exist', async () => {
    mockDb.trustDocument.findMany.mockResolvedValue([]);
    const service = createService();

    await expect(
      service.downloadAllTrustDocumentsByAccessToken('token'),
    ).rejects.toThrow('No additional documents available');
  });

  it('fetches every document and returns a signed bundle URL', async () => {
    mockDb.trustDocument.findMany.mockResolvedValue([
      { id: 'doc_1', name: 'Report.pdf', s3Key: 'org_1/docs/a.pdf' },
      { id: 'doc_2', name: 'report.pdf', s3Key: 'org_1/docs/b.pdf' },
    ]);
    const getKeys: string[] = [];
    let putKey: string | undefined;
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof PutObjectCommand) {
        putKey =
          (command as unknown as { input: { Key?: string } }).input.Key ??
          undefined;
        // Drain the archive stream the way the real S3 upload does. Without
        // a consumer, the service's failure path (zipStream.destroy(err))
        // emits an unhandled 'error' and crashes the worker.
        const body = (command as unknown as { input: { Body: PassThrough } })
          .input.Body;
        body.on('error', () => undefined);
        body.resume();
        return Promise.resolve({});
      }
      if (command instanceof GetObjectCommand) {
        const key = (command as unknown as { input: { Key: string } }).input
          .Key;
        getKeys.push(key);
        return Promise.resolve({
          Body: Readable.from([Buffer.from(`bytes-for-${key}`)]),
        });
      }
      return Promise.resolve({});
    });
    const service = createService();

    const result =
      await service.downloadAllTrustDocumentsByAccessToken('token');

    expect(getKeys).toEqual(['org_1/docs/a.pdf', 'org_1/docs/b.pdf']);
    expect(putKey).toBe('org_1/trust-documents/bundles/grant_1/documents.zip');
    expect(result).toEqual({
      name: 'Additional Documents',
      fileCount: 2,
      downloadUrl: 'https://signed-url/documents.zip',
    });
  });

  it('throws when S3 returns no body for a document', async () => {
    mockDb.trustDocument.findMany.mockResolvedValue([
      { id: 'doc_1', name: 'Report.pdf', s3Key: 'org_1/docs/a.pdf' },
    ]);
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const body = (command as unknown as { input: { Body: PassThrough } })
          .input.Body;
        body.on('error', () => undefined);
        body.resume();
        return Promise.resolve({});
      }
      return Promise.resolve({ Body: undefined });
    });
    const service = createService();

    await expect(
      service.downloadAllTrustDocumentsByAccessToken('token'),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
