jest.mock('@db', () => ({
  db: {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
  Role: {},
}));

jest.mock('../app/s3', () => ({
  s3Client: {},
  getSignedUrl: jest.fn(),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  APP_AWS_ORG_ASSETS_BUCKET: 'bucket',
}));

jest.mock('@gideon-defender/auth', () => ({
  allRoles: {},
}));

import { NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { OrganizationCleanupService } from './organization-cleanup.service';
import { OrganizationService } from './organization.service';
import type { UpdateOrganizationDto } from './dto/update-organization.dto';

const mockedDb = db as unknown as {
  organization: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
};

describe('OrganizationService.updateById', () => {
  const service = new OrganizationService(
    {} as unknown as OrganizationCleanupService,
  );
  const existing = {
    id: 'org_1',
    name: 'Acme',
    slug: 'acme',
    logo: null,
    metadata: null,
    website: null,
    onboardingCompleted: false,
    hasAccess: false,
    fleetDmLabelId: null,
    isFleetSetupCompleted: false,
    primaryColor: null,
    advancedModeEnabled: false,
    createdAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.organization.findUnique.mockResolvedValue(existing);
    mockedDb.organization.update.mockResolvedValue(existing);
  });

  it('persists the profile fields that were provided', async () => {
    await service.updateById('org_1', {
      name: 'New Name',
      website: 'https://acme.com',
    });

    const arg = mockedDb.organization.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'org_1' });
    expect(arg.data.name).toBe('New Name');
    expect(arg.data.website).toBe('https://acme.com');
  });

  it('persists the org-owned onboarding and portal toggles', async () => {
    await service.updateById('org_1', {
      evidenceApprovalEnabled: true,
      deviceAgentStepEnabled: false,
      securityTrainingStepEnabled: false,
      whistleblowerReportEnabled: false,
      accessRequestFormEnabled: true,
    });

    const arg = mockedDb.organization.update.mock.calls[0][0];
    expect(arg.data.evidenceApprovalEnabled).toBe(true);
    expect(arg.data.deviceAgentStepEnabled).toBe(false);
    expect(arg.data.securityTrainingStepEnabled).toBe(false);
    expect(arg.data.whistleblowerReportEnabled).toBe(false);
    expect(arg.data.accessRequestFormEnabled).toBe(true);
  });

  it('never persists hasAccess supplied through the update payload', async () => {
    const payload = {
      name: 'New Name',
      hasAccess: true,
    } as unknown as UpdateOrganizationDto;

    await service.updateById('org_1', payload);

    const arg = mockedDb.organization.update.mock.calls[0][0];
    expect(arg.data).not.toHaveProperty('hasAccess');
  });
});

describe('OrganizationService.deleteById', () => {
  const existing = { id: 'org_1', name: 'Acme' };
  const emptyCollected = {
    keysByBucket: {
      orgAssets: new Set<string>(),
      default: new Set<string>(),
      knowledgeBase: new Set<string>(),
      questionnaire: new Set<string>(),
    },
    knowledgeBaseDocumentIds: [],
    manualAnswerIds: [],
    collectErrors: [],
  };

  function mockCleanupService(
    overrides: {
      collected?: typeof emptyCollected;
      destroyResult?: Record<string, unknown>;
      collectError?: Error;
      destroyError?: Error;
    } = {},
  ) {
    const collectAssetReferences = jest.fn().mockImplementation(() => {
      if (overrides.collectError !== undefined) {
        return Promise.reject(overrides.collectError);
      }
      return Promise.resolve(overrides.collected ?? emptyCollected);
    });
    const deleteCollectedAssets = jest
      .fn()
      .mockImplementation(
        (args?: { collected?: { collectErrors?: string[] } }) => {
          if (overrides.destroyError !== undefined) {
            return Promise.reject(overrides.destroyError);
          }
          const base = overrides.destroyResult ?? {
            s3ObjectsDeleted: 3,
            vectorsDeleted: true,
            knowledgeBaseDocumentsQueued: 1,
            manualAnswersQueued: false,
            collectErrors: [],
            s3Errors: [],
            vectorErrors: [],
          };
          // Mirror the real implementation: collection errors flow through.
          return Promise.resolve({
            ...base,
            collectErrors: args?.collected?.collectErrors ?? base.collectErrors,
          });
        },
      );
    const service = new OrganizationService({
      collectAssetReferences,
      deleteCollectedAssets,
      emptyCollectedAssets: () => emptyCollected,
    } as unknown as OrganizationCleanupService);
    return { service, collectAssetReferences, deleteCollectedAssets };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.organization.findUnique.mockResolvedValue(existing);
    mockedDb.organization.delete.mockResolvedValue(existing);
  });

  it('collects references, deletes the row, then destroys externals — in that order', async () => {
    const { service, collectAssetReferences, deleteCollectedAssets } =
      mockCleanupService();

    const result = await service.deleteById('org_1');

    expect(collectAssetReferences).toHaveBeenCalledWith({
      organizationId: 'org_1',
    });
    expect(mockedDb.organization.delete).toHaveBeenCalledWith({
      where: { id: 'org_1' },
    });
    expect(deleteCollectedAssets).toHaveBeenCalledWith({
      organizationId: 'org_1',
      collected: emptyCollected,
    });
    expect(collectAssetReferences.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDb.organization.delete.mock.invocationCallOrder[0],
    );
    expect(
      mockedDb.organization.delete.mock.invocationCallOrder[0],
    ).toBeLessThan(deleteCollectedAssets.mock.invocationCallOrder[0]);
    expect(result.success).toBe(true);
    expect(result.externalCleanup).toMatchObject({ s3ObjectsDeleted: 3 });
  });

  it('returns partial cleanup errors honestly instead of claiming success', async () => {
    const { service } = mockCleanupService({
      destroyResult: {
        s3ObjectsDeleted: 1,
        vectorsDeleted: false,
        knowledgeBaseDocumentsQueued: 0,
        manualAnswersQueued: false,
        collectErrors: [],
        s3Errors: ['delete batch in kb-bucket: boom'],
        vectorErrors: [],
      },
    });

    const result = await service.deleteById('org_1');

    expect(mockedDb.organization.delete).toHaveBeenCalledWith({
      where: { id: 'org_1' },
    });
    expect(result.success).toBe(true);
    expect(result.externalCleanup?.s3Errors).toEqual([
      'delete batch in kb-bucket: boom',
    ]);
  });

  it('still deletes the row when external destruction fails', async () => {
    const { service } = mockCleanupService({
      destroyError: new Error('S3 down'),
    });

    const result = await service.deleteById('org_1');

    expect(mockedDb.organization.delete).toHaveBeenCalledWith({
      where: { id: 'org_1' },
    });
    expect(result.success).toBe(true);
    expect(result.externalCleanup?.vectorErrors).toEqual([
      'cleanup threw: S3 down',
    ]);
    // The throw may have landed after partial deletes, so S3 state is
    // reported as unknown — never as a clean empty list.
    expect(result.externalCleanup?.s3Errors).toEqual([
      'cleanup threw before completion — S3 and vector state unknown: S3 down',
    ]);
  });

  it('still deletes the row when reference collection fails, recording the error', async () => {
    const { service, deleteCollectedAssets } = mockCleanupService({
      collectError: new Error('table down'),
    });

    const result = await service.deleteById('org_1');

    expect(mockedDb.organization.delete).toHaveBeenCalledWith({
      where: { id: 'org_1' },
    });
    expect(deleteCollectedAssets).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.externalCleanup?.collectErrors).toEqual([
      'collect threw: table down',
    ]);
  });

  it('destroys nothing when the row delete fails', async () => {
    mockedDb.organization.delete.mockRejectedValueOnce(
      new Error('delete failed'),
    );
    const { service, deleteCollectedAssets } = mockCleanupService();

    await expect(service.deleteById('org_1')).rejects.toThrow('delete failed');
    expect(deleteCollectedAssets).not.toHaveBeenCalled();
  });

  it('404s without touching externals when the row is missing', async () => {
    mockedDb.organization.findUnique.mockResolvedValueOnce(null);
    const { service, collectAssetReferences, deleteCollectedAssets } =
      mockCleanupService();

    await expect(service.deleteById('org_1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(collectAssetReferences).not.toHaveBeenCalled();
    expect(mockedDb.organization.delete).not.toHaveBeenCalled();
    expect(deleteCollectedAssets).not.toHaveBeenCalled();
  });
});
