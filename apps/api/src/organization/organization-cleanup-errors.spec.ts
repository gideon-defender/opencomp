const mockSend = jest.fn();
const mockDeleteVectors = jest.fn();
let mockS3Enabled = true;

jest.mock('@db', () => ({
  db: {
    organization: { findUnique: jest.fn() },
    trustResource: { findMany: jest.fn() },
    trustNDAAgreement: { findMany: jest.fn() },
    trustDocument: { findMany: jest.fn() },
    organizationChart: { findUnique: jest.fn() },
    questionnaire: { findMany: jest.fn() },
    knowledgeBaseDocument: { findMany: jest.fn() },
    evidenceAutomationVersion: { findMany: jest.fn() },
    attachment: { findMany: jest.fn() },
    securityQuestionnaireManualAnswer: { findMany: jest.fn() },
  },
}));

jest.mock('../app/s3', () => ({
  get s3Client() {
    return mockS3Enabled
      ? {
          get send() {
            return mockSend;
          },
        }
      : null;
  },
  getSignedUrl: jest.fn(),
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  BUCKET_NAME: 'default-bucket',
  APP_AWS_KNOWLEDGE_BASE_BUCKET: 'kb-bucket',
  APP_AWS_QUESTIONNAIRE_UPLOAD_BUCKET: 'q-bucket',
  extractS3KeyFromUrl: jest.fn((url: string) => {
    if (url === 'not-a-url') throw new Error('unparseable');
    return url;
  }),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  ListObjectsV2Command: jest.fn().mockImplementation((input) => input),
  DeleteObjectsCommand: jest.fn().mockImplementation((input) => input),
}));

jest.mock('../vector-store/lib/core/delete-embeddings', () => ({
  deleteOrganizationEmbeddings: (...args: unknown[]) =>
    mockDeleteVectors(...args),
}));

import { db } from '@db';
import { OrganizationCleanupService } from './organization-cleanup.service';
import { OrganizationS3CleanupService } from './organization-s3-cleanup';
import { OrganizationVectorCleanupService } from './organization-vector-cleanup';
import {
  mockEmptyAssetTables,
  mockListThenDelete,
} from './organization-cleanup.fixtures';

const mockedDb = db as unknown as Record<string, Record<string, jest.Mock>>;

describe('OrganizationCleanupService error reporting', () => {
  const service = new OrganizationCleanupService(
    new OrganizationS3CleanupService(),
    new OrganizationVectorCleanupService(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Enabled = true;
    mockEmptyAssetTables(mockedDb);
    mockDeleteVectors.mockReset();
    mockDeleteVectors.mockResolvedValue(undefined);
  });

  it('records unparseable attachment URLs in collectErrors instead of dropping them', async () => {
    mockedDb.attachment.findMany.mockResolvedValue([
      { url: 'not-a-url' },
      { url: 'org_1/evidence/file.pdf' },
    ]);
    mockListThenDelete(mockSend, { listedByBucket: {} });

    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    expect(result.collectErrors).toHaveLength(1);
    expect(result.collectErrors[0]).toMatch(/attachment/);
    // The parseable attachment is still cleaned.
    expect(result.s3ObjectsDeleted).toBe(1);
    expect(result.s3Errors).toEqual([]);
  });

  it('reports a failed organization-wide vector delete', async () => {
    mockListThenDelete(mockSend, { listedByBucket: {} });
    mockDeleteVectors.mockRejectedValueOnce(new Error('database down'));
    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });
    expect(result.vectorsDeleted).toBe(false);
    expect(result.vectorErrors).toEqual(['vector cleanup: database down']);
  });

  it('still queues vectors when the S3 stage throws unexpectedly', async () => {
    mockedDb.knowledgeBaseDocument.findMany.mockResolvedValue([
      { id: 'kbd_1', s3Key: null },
    ]);
    mockedDb.securityQuestionnaireManualAnswer.findMany.mockResolvedValue([
      { id: 'man_1' },
    ]);
    const s3 = new OrganizationS3CleanupService();
    const isolated = new OrganizationCleanupService(
      s3,
      new OrganizationVectorCleanupService(),
    );
    jest
      .spyOn(s3, 'deleteS3Objects')
      .mockRejectedValueOnce(new Error('S3 down'));

    const result = await isolated.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    expect(result.s3ObjectsDeleted).toBe(0);
    expect(result.s3Errors).toEqual(['S3 cleanup threw: S3 down']);
    expect(result.vectorsDeleted).toBe(true);
    expect(result.manualAnswersQueued).toBe(false);
    expect(result.vectorErrors).toEqual([]);
  });

  it('still deletes S3 objects when the vector stage throws unexpectedly', async () => {
    mockedDb.trustResource.findMany.mockResolvedValue([
      { s3Key: 'org_1/trust.pdf' },
    ]);
    mockListThenDelete(mockSend, { listedByBucket: {} });
    const vectors = new OrganizationVectorCleanupService();
    const isolated = new OrganizationCleanupService(
      new OrganizationS3CleanupService(),
      vectors,
    );
    jest
      .spyOn(vectors, 'deleteOrganizationVectors')
      .mockRejectedValueOnce(new Error('trigger down'));

    const result = await isolated.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    expect(result.s3ObjectsDeleted).toBe(1);
    expect(result.s3Errors).toEqual([]);
    expect(result.vectorErrors).toEqual(['vector cleanup threw: trigger down']);
  });

  it('still deletes snapshot keys when a bucket listing fails', async () => {
    mockedDb.questionnaire.findMany.mockResolvedValue([
      { s3Key: 'org_1/q.pdf' },
    ]);
    mockSend.mockImplementation(
      (command: {
        Bucket?: string;
        Prefix?: string;
        Delete?: { Objects: Array<{ Key?: string }> };
      }) => {
        if (command.Prefix !== undefined && command.Bucket === 'q-bucket') {
          return Promise.reject(new Error('list down'));
        }
        if (command.Prefix !== undefined) {
          return Promise.resolve({ Contents: [], IsTruncated: false });
        }
        return Promise.resolve({ Errors: [] });
      },
    );

    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    expect(result.s3Errors).toHaveLength(1);
    expect(result.s3ObjectsDeleted).toBe(1);
  });

  it('returns zeros without throwing when S3 is not configured', async () => {
    mockS3Enabled = false;
    try {
      const result = await service.cleanupOrganizationAssets({
        organizationId: 'org_1',
      });
      expect(result.s3ObjectsDeleted).toBe(0);
      expect(result.s3Errors).toEqual([]);
      expect(mockSend).not.toHaveBeenCalled();
    } finally {
      mockS3Enabled = true;
    }
  });

  it('reports collected keys as skipped errors when S3 is not configured', async () => {
    mockedDb.trustResource.findMany.mockResolvedValue([
      { s3Key: 'org_1/trust.pdf' },
    ]);
    mockedDb.questionnaire.findMany.mockResolvedValue([
      { s3Key: 'org_1/q.pdf' },
    ]);
    mockS3Enabled = false;
    try {
      const result = await service.cleanupOrganizationAssets({
        organizationId: 'org_1',
      });
      expect(result.s3ObjectsDeleted).toBe(0);
      expect(result.s3Errors).toHaveLength(1);
      expect(result.s3Errors[0]).toMatch(
        /S3 client not configured — 2 collected key\(s\) skipped/,
      );
      expect(mockSend).not.toHaveBeenCalled();
    } finally {
      mockS3Enabled = true;
    }
  });
});
