import { db, TrustFramework } from '@db';
import { TrustPublicCatalogService } from './trust-public-catalog.service';

jest.mock('../app/s3', () => ({
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  s3Client: { send: jest.fn() },
  getSignedUrl: jest.fn(),
}));

jest.mock('@db', () => ({
  db: {
    trust: { findUnique: jest.fn() },
    trustResource: { findMany: jest.fn() },
    vendor: { findMany: jest.fn() },
    globalVendors: { findMany: jest.fn() },
  },
  TrustFramework: {
    soc2_type1: 'soc2_type1',
    soc2_type2: 'soc2_type2',
    soc3: 'soc3',
    iso_27001: 'iso_27001',
    iso_42001: 'iso_42001',
    iso_9001: 'iso_9001',
    gdpr: 'gdpr',
    hipaa: 'hipaa',
    pci_dss: 'pci_dss',
    nen_7510: 'nen_7510',
    pipeda: 'pipeda',
    ccpa: 'ccpa',
    dora: 'dora',
    nis_2: 'nis_2',
    hitrust_csf: 'hitrust_csf',
    nist_csf: 'nist_csf',
    nist_800_53: 'nist_800_53',
  },
}));

type MockFn = jest.Mock;

const mockDb = db as unknown as {
  trust: { findUnique: MockFn };
  trustResource: { findMany: MockFn };
  vendor: { findMany: MockFn };
  globalVendors: { findMany: MockFn };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TrustPublicCatalogService.getPublicFrameworks', () => {
  it('returns [] when the portal is unpublished', async () => {
    const service = new TrustPublicCatalogService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(service.getPublicFrameworks('acme')).resolves.toEqual([]);
    expect(mockDb.trustResource.findMany).not.toHaveBeenCalled();
  });

  it('lists only enabled frameworks with certificate presence', async () => {
    const service = new TrustPublicCatalogService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'published',
      soc2type2: true,
      soc2type2_status: 'compliant',
      iso27001: false,
      iso27001_status: 'started',
    });
    mockDb.trustResource.findMany.mockResolvedValue([
      { framework: TrustFramework.soc2_type2 },
    ]);

    const result = await service.getPublicFrameworks('acme');

    expect(result).toEqual([
      {
        key: 'soc2type2',
        title: 'SOC 2 Type 2',
        status: 'compliant',
        hasCertificate: true,
      },
    ]);
  });
});

describe('TrustPublicCatalogService.getPublicVendors', () => {
  it('returns [] when the portal is unpublished', async () => {
    const service = new TrustPublicCatalogService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(service.getPublicVendors('acme')).resolves.toEqual([]);
    expect(mockDb.vendor.findMany).not.toHaveBeenCalled();
  });

  it('only lists vendors flagged for the trust portal', async () => {
    const service = new TrustPublicCatalogService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'published',
    });
    mockDb.vendor.findMany.mockResolvedValue([]);
    mockDb.globalVendors.findMany.mockResolvedValue([]);

    await service.getPublicVendors('acme');

    expect(mockDb.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org_1',
          showOnTrustPortal: true,
        }),
      }),
    );
  });

  it('drops malformed stored badges instead of crashing', async () => {
    const service = new TrustPublicCatalogService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'published',
    });
    mockDb.vendor.findMany.mockResolvedValue([
      {
        id: 'vnd_bad',
        name: 'Bad',
        description: null,
        website: null,
        logoUrl: null,
        complianceBadges: ['soc2', null, { nope: 1 }, { type: '' }],
      },
    ]);
    mockDb.globalVendors.findMany.mockResolvedValue([]);

    const result = await service.getPublicVendors('acme');

    expect(result[0].complianceBadges).toEqual([]);
  });

  it('prefers freshly derived badges over stale stored ones', async () => {
    const service = new TrustPublicCatalogService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'published',
    });
    mockDb.vendor.findMany.mockResolvedValue([
      {
        id: 'vnd_1',
        name: 'Scaleway',
        description: null,
        website: 'scaleway.com',
        logoUrl: null,
        complianceBadges: [{ type: 'gdpr' }],
      },
    ]);
    mockDb.globalVendors.findMany.mockResolvedValue([
      {
        website: 'scaleway.com',
        riskAssessmentData: {
          certifications: [{ type: 'ISO/IEC 27001:2022', status: 'verified' }],
          links: [{ url: 'https://trust.scaleway.com' }],
        },
      },
    ]);

    const result = await service.getPublicVendors('acme');

    expect(result[0].trustPortalUrl).toBe('https://trust.scaleway.com');
    expect(result[0].complianceBadges.map((b) => b.type)).toContain('iso27001');
  });

  it('ignores non-http(s) enrichment URLs and keeps the vendor website', async () => {
    const service = new TrustPublicCatalogService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'published',
    });
    mockDb.vendor.findMany.mockResolvedValue([
      {
        id: 'vnd_1',
        name: 'Evil',
        description: null,
        website: 'https://evil.example.com',
        logoUrl: null,
        complianceBadges: [],
      },
    ]);
    mockDb.globalVendors.findMany.mockResolvedValue([
      {
        website: 'https://evil.example.com',
        riskAssessmentData: {
          links: [{ url: 'javascript:alert(1)' }],
        },
      },
    ]);

    const result = await service.getPublicVendors('acme');

    expect(result[0].trustPortalUrl).toBe('https://evil.example.com');
  });
});

describe('TrustPublicCatalogService vendor logo safety', () => {
  it('nulls non-http(s) stored logo URLs instead of serving them to <img>', async () => {
    const service = new TrustPublicCatalogService();
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'published',
    });
    mockDb.vendor.findMany.mockResolvedValue([
      {
        id: 'vnd_evil',
        name: 'Evil',
        description: null,
        website: 'https://evil.example.com',
        logoUrl: 'javascript:alert(1)',
        complianceBadges: [],
      },
      {
        id: 'vnd_ok',
        name: 'Ok',
        description: null,
        website: 'https://ok.example.com',
        logoUrl: 'https://ok.example.com/logo.png',
        complianceBadges: [],
      },
    ]);
    mockDb.globalVendors.findMany.mockResolvedValue([]);

    const result = await service.getPublicVendors('acme');

    expect(result.find((v) => v.id === 'vnd_evil')?.logoUrl).toBeNull();
    expect(result.find((v) => v.id === 'vnd_ok')?.logoUrl).toBe(
      'https://ok.example.com/logo.png',
    );
  });
});
