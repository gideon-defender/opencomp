const mockSend = jest.fn();
const mockBucketNames: Record<string, string | undefined> = {};

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

describe('organization S3 ownership', () => {
  it.each([
    'org_2/logo.png',
    'org_10/logo.png',
    'legacy.png',
    '../org_2/logo.png',
  ])('never deletes the unowned snapshot key %s', async (key) => {
    mockSend.mockReset();
    mockSend.mockImplementation((command: { Prefix?: string }) =>
      Promise.resolve(
        command.Prefix ? { Contents: [], IsTruncated: false } : { Errors: [] },
      ),
    );
    const keys = emptyKeys();
    keys.orgAssets.add(key);
    keys.default.add('org_1/own.pdf');
    const result = await new OrganizationS3CleanupService().deleteS3Objects({
      organizationId: 'org_1',
      keysByBucket: keys,
    });
    const deleted = mockSend.mock.calls.flatMap(
      ([command]) => command.Delete?.Objects ?? [],
    );
    expect(deleted).toEqual([{ Key: 'org_1/own.pdf' }]);
    expect(result.deleted).toBe(1);
    expect(result.errors).toEqual([
      'Skipped S3 key outside organization namespace in org-assets',
    ]);
  });
});
