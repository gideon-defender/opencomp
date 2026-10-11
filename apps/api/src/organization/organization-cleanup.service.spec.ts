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

import { extractS3KeyFromUrl } from '../app/s3';
import { db } from '@db';
import { OrganizationCleanupService } from './organization-cleanup.service';
import { OrganizationS3CleanupService } from './organization-s3-cleanup';
import { OrganizationVectorCleanupService } from './organization-vector-cleanup';
import {
  mockEmptyAssetTables,
  mockListThenDelete,
} from './organization-cleanup.fixtures';

const mockedDb = db as unknown as Record<string, Record<string, jest.Mock>>;

describe('OrganizationCleanupService', () => {
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
  it('deletes each snapshot key from its home bucket only, plus prefix-listed keys', async () => {
    mockedDb.organization.findUnique.mockResolvedValue({
      logo: 'org_1/logo.png',
    });
    mockedDb.trustResource.findMany.mockResolvedValue([
      { s3Key: 'org_1/trust.pdf' },
    ]);
    mockedDb.questionnaire.findMany.mockResolvedValue([
      { s3Key: 'org_1/q.pdf' },
    ]);
    mockedDb.knowledgeBaseDocument.findMany.mockResolvedValue([
      { id: 'kbd_1', s3Key: 'org_1/kb/doc.pdf' },
    ]);
    mockedDb.securityQuestionnaireManualAnswer.findMany.mockResolvedValue([
      { id: 'man_1' },
    ]);
    mockListThenDelete(mockSend, {
      listedByBucket: { 'org-assets': ['org_1/listed.pdf'] },
    });

    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    // org-assets: logo + trust + listed; questionnaire: q.pdf; kb: kb/doc.pdf.
    // No fan-out: 3 + 1 + 1 = 5 deletes across 4 buckets.
    expect(result.s3ObjectsDeleted).toBe(5);
    expect(result.collectErrors).toEqual([]);
    expect(result.s3Errors).toEqual([]);
    expect(result.vectorErrors).toEqual([]);
    const deleteCalls = mockSend.mock.calls.filter(
      ([cmd]) => (cmd as { Delete?: unknown }).Delete !== undefined,
    );
    const byBucket = new Map(
      deleteCalls.map(([cmd]) => [
        (cmd as { Bucket: string }).Bucket,
        (
          cmd as { Delete: { Objects: Array<{ Key: string }> } }
        ).Delete.Objects.map((o) => o.Key),
      ]),
    );
    expect([...(byBucket.get('org-assets') ?? [])].sort()).toEqual(
      ['org_1/logo.png', 'org_1/listed.pdf', 'org_1/trust.pdf'].sort(),
    );
    expect(byBucket.get('q-bucket')).toEqual(['org_1/q.pdf']);
    expect(byBucket.get('kb-bucket')).toEqual(['org_1/kb/doc.pdf']);
    expect(byBucket.has('default-bucket')).toBe(false);
    expect(result.vectorsDeleted).toBe(true);
    expect(result.manualAnswersQueued).toBe(false);
  });
  it('routes NDA, trust-document, org-chart, and script keys to their home buckets', async () => {
    mockedDb.trustNDAAgreement.findMany.mockResolvedValue([
      {
        pdfTemplateKey: 'org_1/nda/template.pdf',
        pdfSignedKey: 'org_1/nda/signed.pdf',
      },
    ]);
    mockedDb.trustDocument.findMany.mockResolvedValue([
      { s3Key: 'org_1/trustdoc.pdf' },
    ]);
    mockedDb.organizationChart.findUnique.mockResolvedValue({
      uploadedImageUrl: 'org_1/chart.png',
    });
    mockedDb.evidenceAutomationVersion.findMany.mockResolvedValue([
      { scriptKey: 'org_1/scripts/run.js' },
    ]);
    mockListThenDelete(mockSend, { listedByBucket: {} });

    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    // 1 trust-doc (org-assets) + NDA pair, chart, script (default) = 5 deletes.
    expect(result.s3ObjectsDeleted).toBe(5);
    expect(result.collectErrors).toEqual([]);
    expect(result.s3Errors).toEqual([]);
    const deleteCalls = mockSend.mock.calls.filter(
      ([cmd]) => (cmd as { Delete?: unknown }).Delete !== undefined,
    );
    const byBucket = new Map(
      deleteCalls.map(([cmd]) => [
        (cmd as { Bucket: string }).Bucket,
        (
          cmd as { Delete: { Objects: Array<{ Key: string }> } }
        ).Delete.Objects.map((o) => o.Key),
      ]),
    );
    expect([...(byBucket.get('default-bucket') ?? [])].sort()).toEqual(
      [
        'org_1/chart.png',
        'org_1/nda/signed.pdf',
        'org_1/nda/template.pdf',
        'org_1/scripts/run.js',
      ].sort(),
    );
    expect(byBucket.get('org-assets')).toEqual(['org_1/trustdoc.pdf']);
  });
  it('queues nothing and deletes nothing when the org has no assets', async () => {
    mockSend.mockResolvedValue({ Contents: [], IsTruncated: false });

    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_empty',
    });

    expect(result.s3ObjectsDeleted).toBe(0);
    expect(result.knowledgeBaseDocumentsQueued).toBe(0);
    expect(result.manualAnswersQueued).toBe(false);
    expect(result.collectErrors).toEqual([]);
    expect(result.s3Errors).toEqual([]);
    expect(result.vectorErrors).toEqual([]);
    expect(mockDeleteVectors).toHaveBeenCalledWith('org_empty');
  });
  it('follows pagination across multiple list pages', async () => {
    mockSend.mockImplementation(
      (command: {
        Prefix?: string;
        ContinuationToken?: string;
        Delete?: { Objects: Array<{ Key?: string }> };
      }) => {
        if (command.Prefix !== undefined) {
          if (!command.ContinuationToken) {
            return Promise.resolve({
              Contents: [{ Key: 'org_1/a.pdf' }],
              IsTruncated: true,
              NextContinuationToken: 'tok',
            });
          }
          return Promise.resolve({
            Contents: [{ Key: 'org_1/b.pdf' }],
            IsTruncated: false,
          });
        }
        return Promise.resolve({ Errors: [] });
      },
    );

    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    // 2 listed keys × 4 buckets = 8 deletes, none lost to truncation.
    expect(result.s3ObjectsDeleted).toBe(8);
    expect(result.s3Errors).toEqual([]);
  });
  it('records S3 delete errors per bucket and still attempts the rest plus vectors', async () => {
    mockSend.mockImplementation(
      (command: {
        Bucket?: string;
        Prefix?: string;
        Delete?: { Objects: Array<{ Key?: string }> };
      }) => {
        if (command.Prefix !== undefined) {
          return Promise.resolve({ Contents: [], IsTruncated: false });
        }
        if (command.Bucket === 'org-assets') {
          return Promise.resolve({ Errors: [{ Key: 'org_1/logo.png' }] });
        }
        return Promise.resolve({ Errors: [] });
      },
    );
    mockedDb.organization.findUnique.mockResolvedValue({
      logo: 'org_1/logo.png',
    });
    mockedDb.knowledgeBaseDocument.findMany.mockResolvedValue([
      { id: 'kbd_1', s3Key: 'org_1/kb/doc.pdf' },
    ]);

    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    expect(result.s3Errors.length).toBeGreaterThan(0);
    expect(result.s3Errors[0]).toMatch(/org-assets/);
    // kb bucket delete still ran, and vectors still queued.
    expect(result.s3ObjectsDeleted).toBe(1);
    expect(result.vectorsDeleted).toBe(true);
    expect(mockDeleteVectors).toHaveBeenCalled();
  });
  it('skips attachments with unparseable URLs and cleans the rest', async () => {
    mockedDb.attachment.findMany.mockResolvedValue([
      { url: 'not-a-url' },
      { url: 'org_1/evidence/file.pdf' },
    ]);
    mockListThenDelete(mockSend, { listedByBucket: {} });

    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    expect(extractS3KeyFromUrl).toHaveBeenCalled();
    expect(result.s3ObjectsDeleted).toBe(1);
    expect(result.s3Errors).toEqual([]);
  });
  it('isolates a failing source table instead of orphaning everything', async () => {
    mockedDb.trustResource.findMany.mockRejectedValue(new Error('table down'));
    mockedDb.questionnaire.findMany.mockResolvedValue([
      { s3Key: 'org_1/q.pdf' },
    ]);
    mockListThenDelete(mockSend, { listedByBucket: {} });

    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });

    expect(result.collectErrors).toHaveLength(1);
    expect(result.collectErrors[0]).toMatch(/trustResource/);
    expect(result.s3ObjectsDeleted).toBe(1);
  });
  it('reports an organization-wide vector delete failure', async () => {
    mockListThenDelete(mockSend, { listedByBucket: {} });
    mockDeleteVectors.mockRejectedValueOnce(new Error('database down'));
    const result = await service.cleanupOrganizationAssets({
      organizationId: 'org_1',
    });
    expect(result.vectorsDeleted).toBe(false);
    expect(result.vectorErrors).toEqual(['vector cleanup: database down']);
    expect(mockDeleteVectors).toHaveBeenCalledTimes(1);
  });
});
