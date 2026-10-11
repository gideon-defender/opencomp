const mockSend = jest.fn();
let mockBucketNames: Record<string, string | undefined> = {};

jest.mock('../app/s3', () => ({
  get s3Client() {
    return {
      get send() {
        return mockSend;
      },
    };
  },
  getSignedUrl: jest.fn(),
  get APP_AWS_ORG_ASSETS_BUCKET() {
    return 'orgAssets' in mockBucketNames
      ? mockBucketNames.orgAssets
      : 'org-assets';
  },
  get BUCKET_NAME() {
    return 'default' in mockBucketNames
      ? mockBucketNames.default
      : 'default-bucket';
  },
  get APP_AWS_KNOWLEDGE_BASE_BUCKET() {
    return 'knowledgeBase' in mockBucketNames
      ? mockBucketNames.knowledgeBase
      : 'kb-bucket';
  },
  get APP_AWS_QUESTIONNAIRE_UPLOAD_BUCKET() {
    return 'questionnaire' in mockBucketNames
      ? mockBucketNames.questionnaire
      : 'q-bucket';
  },
}));

jest.mock('@aws-sdk/client-s3', () => ({
  ListObjectsV2Command: jest.fn().mockImplementation((input) => input),
  DeleteObjectsCommand: jest.fn().mockImplementation((input) => input),
}));

import { OrganizationS3CleanupService } from './organization-s3-cleanup';
import type { CleanupBucketRef } from './organization-cleanup.types';

function emptyKeys(): Record<CleanupBucketRef, Set<string>> {
  return {
    orgAssets: new Set(),
    default: new Set(),
    knowledgeBase: new Set(),
    questionnaire: new Set(),
  };
}

describe('OrganizationS3CleanupService', () => {
  const service = new OrganizationS3CleanupService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockBucketNames = {};
  });

  it('deletes each key exactly once when the listing is stable', async () => {
    const keys = emptyKeys();
    keys.orgAssets.add('org_1/snap.pdf');
    mockSend.mockImplementation(
      (command: { Bucket?: string; Prefix?: string }) => {
        if (command.Prefix !== undefined) {
          const contents =
            command.Bucket === 'org-assets'
              ? [{ Key: 'org_1/listed.pdf' }]
              : [];
          return Promise.resolve({ Contents: contents, IsTruncated: false });
        }
        return Promise.resolve({ Errors: [] });
      },
    );

    const result = await service.deleteS3Objects({
      organizationId: 'org_1',
      keysByBucket: keys,
    });

    // snap + listed in org-assets, nothing elsewhere: 2 deletes total.
    expect(result.deleted).toBe(2);
    expect(result.errors).toEqual([]);
    const deletes = mockSend.mock.calls.filter(
      ([cmd]) => (cmd as { Delete?: unknown }).Delete !== undefined,
    );
    expect(deletes).toHaveLength(1);
  });

  it('picks up a key listed after the first delete on the verification pass', async () => {
    const keys = emptyKeys();
    keys.orgAssets.add('org_1/snap.pdf');
    let orgAssetsLists = 0;
    mockSend.mockImplementation(
      (command: { Bucket?: string; Prefix?: string; Delete?: unknown }) => {
        if (command.Prefix !== undefined) {
          if (command.Bucket !== 'org-assets') {
            return Promise.resolve({ Contents: [], IsTruncated: false });
          }
          orgAssetsLists += 1;
          const contents =
            orgAssetsLists === 1 ? [] : [{ Key: 'org_1/straggler.pdf' }];
          return Promise.resolve({ Contents: contents, IsTruncated: false });
        }
        return Promise.resolve({ Errors: [] });
      },
    );

    const result = await service.deleteS3Objects({
      organizationId: 'org_1',
      keysByBucket: keys,
    });

    expect(result.deleted).toBe(2);
    expect(result.errors).toEqual([]);
    const deletedKeys = mockSend.mock.calls
      .filter(([cmd]) => (cmd as { Delete?: unknown }).Delete !== undefined)
      .flatMap(
        ([cmd]) =>
          (cmd as { Delete: { Objects: Array<{ Key: string }> } }).Delete
            .Objects,
      )
      .map((o) => o.Key);
    expect(deletedKeys.sort()).toEqual([
      'org_1/snap.pdf',
      'org_1/straggler.pdf',
    ]);
  });

  it('names each failed key with its S3 code in the errors', async () => {
    const keys = emptyKeys();
    keys.orgAssets.add('org_1/gone.pdf');
    mockSend.mockImplementation((command: { Prefix?: string }) => {
      if (command.Prefix !== undefined) {
        return Promise.resolve({ Contents: [], IsTruncated: false });
      }
      return Promise.resolve({
        Errors: [
          { Key: 'org_1/gone.pdf', Code: 'AccessDenied', Message: 'denied' },
        ],
      });
    });

    const result = await service.deleteS3Objects({
      organizationId: 'org_1',
      keysByBucket: keys,
    });

    expect(result.deleted).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/gone\.pdf/);
    expect(result.errors[0]).toMatch(/org-assets/);
    expect(result.errors[0]).toMatch(/AccessDenied/);
  });

  it('retries a throwing delete batch a bounded number of times', async () => {
    const keys = emptyKeys();
    keys.orgAssets.add('org_1/snap.pdf');
    mockSend.mockImplementation((command: { Prefix?: string }) => {
      if (command.Prefix !== undefined) {
        return Promise.resolve({ Contents: [], IsTruncated: false });
      }
      return Promise.reject(new Error('s3 down'));
    });

    const result = await service.deleteS3Objects({
      organizationId: 'org_1',
      keysByBucket: keys,
    });

    expect(result.deleted).toBe(0);
    const deletes = mockSend.mock.calls.filter(
      ([cmd]) => (cmd as { Delete?: unknown }).Delete !== undefined,
    );
    // Initial attempt plus bounded retries — never unbounded.
    expect(deletes).toHaveLength(3);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toMatch(/delete batch/);
  });

  it('still deletes snapshot keys when the first listing fails, without re-listing', async () => {
    const keys = emptyKeys();
    keys.questionnaire.add('org_1/q.pdf');
    mockSend.mockImplementation(
      (command: { Bucket?: string; Prefix?: string }) => {
        if (command.Prefix !== undefined && command.Bucket === 'q-bucket') {
          return Promise.reject(new Error('list down'));
        }
        if (command.Prefix !== undefined) {
          return Promise.resolve({ Contents: [], IsTruncated: false });
        }
        return Promise.resolve({ Errors: [] });
      },
    );

    const result = await service.deleteS3Objects({
      organizationId: 'org_1',
      keysByBucket: keys,
    });

    // One list error, no verification noise; the snapshot key is deleted.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/list q-bucket/);
    expect(result.deleted).toBe(1);
  });

  it('records collected keys whose bucket is not configured', async () => {
    mockBucketNames = {
      orgAssets: 'org-assets',
      default: undefined,
      knowledgeBase: 'kb-bucket',
      questionnaire: 'q-bucket',
    };
    const keys = emptyKeys();
    keys.default.add('org_1/orphan.pdf');
    mockSend.mockImplementation((command: { Prefix?: string }) => {
      if (command.Prefix !== undefined) {
        return Promise.resolve({ Contents: [], IsTruncated: false });
      }
      return Promise.resolve({ Errors: [] });
    });

    const result = await service.deleteS3Objects({
      organizationId: 'org_1',
      keysByBucket: keys,
    });

    expect(result.deleted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/not configured/);
  });

  it('continues with remaining buckets when one bucket throws unexpectedly', async () => {
    const keys = emptyKeys();
    keys.orgAssets.add('org_1/logo.png');
    keys.default.add('org_1/doc.pdf');
    mockSend.mockImplementation((command: { Prefix?: string }) => {
      if (command.Prefix !== undefined) {
        return Promise.resolve({ Contents: [], IsTruncated: false });
      }
      return Promise.resolve({ Errors: [] });
    });
    jest
      .spyOn(
        service as unknown as {
          deleteBucketPrefix(args: {
            organizationId: string;
            bucket: string;
            snapshotKeys: Set<string>;
          }): Promise<{ deleted: number; errors: string[] }>;
        },
        'deleteBucketPrefix',
      )
      .mockRejectedValueOnce(new Error('bucket boom'));

    const result = await service.deleteS3Objects({
      organizationId: 'org_1',
      keysByBucket: keys,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(
      /S3 cleanup threw for bucket org-assets.*bucket boom/,
    );
    expect(result.deleted).toBe(1);
  });

  it('stops re-listing after a bounded number of passes when keys keep arriving', async () => {
    const keys = emptyKeys();
    keys.orgAssets.add('org_1/snap.pdf');
    let freshKeys = 0;
    mockSend.mockImplementation(
      (command: { Bucket?: string; Prefix?: string; Delete?: unknown }) => {
        if (command.Prefix !== undefined) {
          if (command.Bucket !== 'org-assets') {
            return Promise.resolve({ Contents: [], IsTruncated: false });
          }
          // Every verification listing surfaces one brand-new key, so the
          // bucket never converges on its own.
          freshKeys += 1;
          return Promise.resolve({
            Contents: [{ Key: `org_1/fresh-${freshKeys}.pdf` }],
            IsTruncated: false,
          });
        }
        return Promise.resolve({ Errors: [] });
      },
    );

    const result = await service.deleteS3Objects({
      organizationId: 'org_1',
      keysByBucket: keys,
    });

    const deletes = mockSend.mock.calls.filter(
      ([cmd]) => (cmd as { Delete?: unknown }).Delete !== undefined,
    );
    // Initial pass plus bounded verification retries — never unbounded.
    expect(deletes).toHaveLength(3);
    expect(result.errors).toEqual([]);
  });
});
