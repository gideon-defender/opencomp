import { db } from '@db';
import { TrustCustomFrameworkService } from './trust-custom-framework.service';
import { TrustPublicService } from './trust-public.service';

jest.mock('@db', () => ({
  db: {
    trust: {
      findUnique: jest.fn(),
    },
  },
  Prisma: {},
  TrustFramework: {},
}));

jest.mock('../app/s3', () => ({
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  s3Client: { send: jest.fn() },
  getSignedUrl: jest.fn(),
}));

const mockDb = db as unknown as {
  trust: { findUnique: jest.Mock };
};

describe('TrustPublicService.getPublicSecurityQuestionnaireEnabled', () => {
  const service = new TrustPublicService(
    {} as unknown as TrustCustomFrameworkService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves by friendlyUrl first', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      securityQuestionnaireEnabled: false,
      status: 'published',
    });

    const result = await service.getPublicSecurityQuestionnaireEnabled('acme');

    expect(result).toBe(false);
    expect(mockDb.trust.findUnique).toHaveBeenCalledTimes(1);
    expect(mockDb.trust.findUnique).toHaveBeenNthCalledWith(1, {
      where: { friendlyUrl: 'acme' },
      select: { securityQuestionnaireEnabled: true, status: true },
    });
  });

  it('falls back to organizationId when friendlyUrl does not match', async () => {
    mockDb.trust.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      securityQuestionnaireEnabled: false,
      status: 'published',
    });

    const result =
      await service.getPublicSecurityQuestionnaireEnabled('org_123');

    expect(result).toBe(false);
    expect(mockDb.trust.findUnique).toHaveBeenNthCalledWith(2, {
      where: { organizationId: 'org_123' },
      select: { securityQuestionnaireEnabled: true, status: true },
    });
  });

  it('returns true when the flag is enabled on a published portal', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      securityQuestionnaireEnabled: true,
      status: 'published',
    });

    await expect(
      service.getPublicSecurityQuestionnaireEnabled('acme'),
    ).resolves.toBe(true);
  });

  it('returns false when the portal is unpublished', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      securityQuestionnaireEnabled: true,
      status: 'draft',
    });

    await expect(
      service.getPublicSecurityQuestionnaireEnabled('acme'),
    ).resolves.toBe(false);
  });

  it('returns false when the portal cannot be resolved', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);

    await expect(
      service.getPublicSecurityQuestionnaireEnabled('unknown'),
    ).resolves.toBe(false);
  });
});
