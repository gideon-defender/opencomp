import { NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { getSignedUrl } from '../app/s3';
import { TrustCustomFrameworkService } from './trust-custom-framework.service';
import {
  resolveTrustByFriendlyUrl,
  TrustPublicService,
} from './trust-public.service';

jest.mock('@db', () => ({
  db: {
    trust: { findUnique: jest.fn() },
    organization: { findUnique: jest.fn() },
    policy: { findMany: jest.fn() },
    control: { findMany: jest.fn() },
    trustCustomLink: { findMany: jest.fn() },
  },
}));

jest.mock('../app/s3', () => ({
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  s3Client: { send: jest.fn() },
  getSignedUrl: jest.fn(),
}));

type MockFn = jest.Mock;

const mockDb = db as unknown as {
  trust: { findUnique: MockFn };
  organization: { findUnique: MockFn };
  policy: { findMany: MockFn };
  control: { findMany: MockFn };
  trustCustomLink: { findMany: MockFn };
};

const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<
  typeof getSignedUrl
>;

function makeService() {
  const frameworks = {
    getPublicCustomFrameworks: jest.fn(),
  } as unknown as TrustCustomFrameworkService;
  return {
    service: new TrustPublicService(frameworks),
    frameworks: frameworks as unknown as { getPublicCustomFrameworks: MockFn },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resolveTrustByFriendlyUrl', () => {
  it('prefers the friendlyUrl match over the organizationId fallback', async () => {
    const byFriendly = { organizationId: 'org_a', status: 'published' };
    mockDb.trust.findUnique.mockResolvedValueOnce(byFriendly);

    const result = await resolveTrustByFriendlyUrl('acme', {
      organizationId: true,
      status: true,
    });

    expect(result).toEqual(byFriendly);
    expect(mockDb.trust.findUnique).toHaveBeenCalledTimes(1);
    expect(mockDb.trust.findUnique).toHaveBeenCalledWith({
      where: { friendlyUrl: 'acme' },
      select: { organizationId: true, status: true },
    });
  });

  it('falls back to organizationId when the friendlyUrl misses', async () => {
    mockDb.trust.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ organizationId: 'org_1', status: 'published' });

    const result = await resolveTrustByFriendlyUrl('org_1', {
      organizationId: true,
      status: true,
    });

    expect(result).toEqual({ organizationId: 'org_1', status: 'published' });
    expect(mockDb.trust.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('TrustPublicService.getPublicProfile', () => {
  it('returns header data for a published portal', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      friendlyUrl: 'acme',
      domain: null,
      domainVerified: false,
      contactEmail: 'security@acme.com',
      status: 'published',
    });
    mockDb.organization.findUnique.mockResolvedValue({
      name: 'Acme',
      primaryColor: '#065f46',
      logo: null,
    });

    await expect(service.getPublicProfile('acme')).resolves.toEqual({
      organizationName: 'Acme',
      domain: null,
      domainVerified: false,
      friendlyUrl: 'acme',
      primaryColor: '#065f46',
      logoUrl: null,
      faviconUrl: null,
      contactEmail: 'security@acme.com',
    });
  });

  it('throws NotFound for a draft portal', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(service.getPublicProfile('acme')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('TrustPublicService policies and controls', () => {
  it('returns only published, non-archived policies', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'published',
    });
    mockDb.policy.findMany.mockResolvedValue([
      { id: 'pol_1', name: 'Security', updatedAt: new Date() },
    ]);

    const result = await service.getPublicPolicies('acme');

    expect(result).toHaveLength(1);
    expect(mockDb.policy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org_1',
          status: 'published',
          isArchived: false,
        }),
      }),
    );
  });

  it('returns [] for policies when the portal is unpublished', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(service.getPublicPolicies('acme')).resolves.toEqual([]);
    expect(mockDb.policy.findMany).not.toHaveBeenCalled();
  });

  it('returns [] for controls when the portal is unpublished', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(service.getPublicControls('acme')).resolves.toEqual([]);
    expect(mockDb.control.findMany).not.toHaveBeenCalled();
  });
});

describe('TrustPublicService overview and questionnaire', () => {
  it('returns null when the overview section is hidden', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      overviewTitle: 'Hi',
      overviewContent: 'Body',
      showOverview: false,
      status: 'published',
    });

    await expect(service.getPublicOverview('acme')).resolves.toBeNull();
  });

  it('disables the questionnaire when the portal is missing', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue(null);

    await expect(
      service.getPublicSecurityQuestionnaireEnabled('nope'),
    ).resolves.toBe(false);
  });

  it('disables the questionnaire when the portal is unpublished', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      securityQuestionnaireEnabled: true,
      status: 'draft',
    });

    await expect(
      service.getPublicSecurityQuestionnaireEnabled('acme'),
    ).resolves.toBe(false);
  });

  it('returns the stored flag for a published portal', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      securityQuestionnaireEnabled: true,
      status: 'published',
    });

    await expect(
      service.getPublicSecurityQuestionnaireEnabled('acme'),
    ).resolves.toBe(true);
  });
});

describe('TrustPublicService links, favicon, faqs, branding', () => {
  it('returns [] for custom links when the portal is unpublished', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(service.getPublicCustomLinks('acme')).resolves.toEqual([]);
  });

  it('returns null favicon when none is set', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      favicon: null,
      status: 'published',
    });

    await expect(service.getPublicFavicon('acme')).resolves.toBeNull();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('throws NotFound for faqs on an unpublished portal', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(service.getFaqs('acme')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('falls back to organizationId branding when no trust row exists', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.organization.findUnique.mockResolvedValue({
      logo: null,
      primaryColor: '#065f46',
    });

    await expect(
      service.getTrustBrandingByOrganizationId('org_1'),
    ).resolves.toEqual({
      friendlyUrl: 'org_1',
      faviconUrl: null,
      logoUrl: null,
      primaryColor: '#065f46',
      securityQuestionnaireEnabled: true,
    });
  });

  it('delegates custom frameworks to the dedicated service', async () => {
    const { service, frameworks } = makeService();
    frameworks.getPublicCustomFrameworks.mockResolvedValue([{ id: 'cfrm_1' }]);

    await expect(service.getPublicCustomFrameworks('acme')).resolves.toEqual([
      { id: 'cfrm_1' },
    ]);
    expect(frameworks.getPublicCustomFrameworks).toHaveBeenCalledWith('acme');
  });
});

describe('TrustPublicService custom link safety', () => {
  it('filters non-http(s) legacy links from the public read', async () => {
    const { service } = makeService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'published',
    });
    mockDb.trustCustomLink.findMany.mockResolvedValue([
      {
        id: 'lnk_1',
        title: 'Docs',
        description: null,
        url: 'https://docs.example.com',
      },
      {
        id: 'lnk_2',
        title: 'Evil',
        description: null,
        url: 'javascript:alert(1)',
      },
    ]);

    const result = await service.getPublicCustomLinks('acme');

    expect(result.map((link) => link.id)).toEqual(['lnk_1']);
  });
});
