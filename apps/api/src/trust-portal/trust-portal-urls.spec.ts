import { NotFoundException } from '@nestjs/common';
import { db, Prisma } from '@db';
import {
  buildPortalAccessUrl,
  buildPortalBaseUrl,
  buildPublicNdaSigningLink,
  buildPublicPortalAccessUrl,
  buildPublicPortalBaseUrl,
  ensureFriendlyUrl,
  findPublishedTrustByRouteId,
  isReservedPortalSlug,
  resolveTrustAppUrl,
} from './trust-portal-urls';

jest.mock('@db', () => ({
  db: {
    trust: { findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn() },
  },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;

      constructor(message: string, args: { code: string }) {
        super(message);
        this.code = args.code;
      }
    },
  },
}));

type MockFn = jest.Mock;

const mockDb = db as unknown as {
  trust: { findUnique: MockFn; findFirst: MockFn; upsert: MockFn };
};

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ensureFriendlyUrl', () => {
  it('returns the existing friendlyUrl without writing', async () => {
    mockDb.trust.findUnique.mockResolvedValue({ friendlyUrl: 'acme' });

    const result = await ensureFriendlyUrl('org_1');

    expect(result).toBe('acme');
    expect(mockDb.trust.upsert).not.toHaveBeenCalled();
  });

  it('upserts the organizationId slug when none exists', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.trust.upsert.mockResolvedValue({ friendlyUrl: 'org_1' });

    const result = await ensureFriendlyUrl('org_1');

    expect(result).toBe('org_1');
    expect(mockDb.trust.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org_1' },
      }),
    );
  });

  it('retries with a suffixed slug instead of returning a colliding value', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.trust.upsert
      .mockRejectedValueOnce(p2002())
      .mockResolvedValue({ friendlyUrl: 'org_1-2' });

    const result = await ensureFriendlyUrl('org_1');

    expect(result).toBe('org_1-2');
    expect(mockDb.trust.upsert).toHaveBeenCalledTimes(2);
  });

  it('prefers a slugified organization name when provided', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.trust.upsert.mockResolvedValue({ friendlyUrl: 'acme-and-co' });

    const result = await ensureFriendlyUrl('org_1', {
      organizationName: 'Acme & Co!',
    });

    expect(result).toBe('acme-and-co');
    expect(mockDb.trust.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ friendlyUrl: 'acme-and-co' }),
      }),
    );
  });

  it('falls back to the organizationId when the name slugifies to empty', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.trust.upsert.mockResolvedValue({ friendlyUrl: 'org_1' });

    const result = await ensureFriendlyUrl('org_1', {
      organizationName: '!!!',
    });

    expect(result).toBe('org_1');
  });

  it('skips a slug claimed by another org without writing it', async () => {
    mockDb.trust.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ organizationId: 'org_2' })
      .mockResolvedValue(null);
    mockDb.trust.upsert.mockResolvedValue({ friendlyUrl: 'org_1-2' });

    const result = await ensureFriendlyUrl('org_1');

    expect(result).toBe('org_1-2');
    const writtenSlugs = mockDb.trust.upsert.mock.calls.map(
      (call: Array<{ update: { friendlyUrl: string } }>) =>
        call[0].update.friendlyUrl,
    );
    expect(writtenSlugs).not.toContain('org_1');
  });

  it('reuses a slug assigned concurrently after a conflict', async () => {
    mockDb.trust.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ friendlyUrl: 'acme' });
    mockDb.trust.upsert.mockRejectedValue(p2002());

    const result = await ensureFriendlyUrl('org_1');

    expect(result).toBe('acme');
  });

  it('rethrows non-conflict errors', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.trust.upsert.mockRejectedValue(new Error('db down'));

    await expect(ensureFriendlyUrl('org_1')).rejects.toThrow('db down');
  });

  it('throws a conflict error when no unique slug is found', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.trust.upsert.mockRejectedValue(p2002());

    await expect(ensureFriendlyUrl('org_1')).rejects.toThrow(
      'Could not assign a portal URL',
    );
    expect(mockDb.trust.upsert).toHaveBeenCalledTimes(50);
  });
});

describe('buildPortalBaseUrl', () => {
  it('prefers the verified custom domain', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      domain: 'Trust.Acme.com/',
      domainVerified: true,
      friendlyUrl: 'acme',
    });

    const result = await buildPortalBaseUrl({
      trustAppUrl: 'https://trust.gideondefender.com',
      organizationId: 'org_1',
    });

    expect(result).toBe('https://trust.acme.com');
    expect(mockDb.trust.upsert).not.toHaveBeenCalled();
  });

  it('falls back to the friendlyUrl when the domain is unverified', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      domain: 'acme.com',
      domainVerified: false,
      friendlyUrl: 'acme',
    });

    const result = await buildPortalBaseUrl({
      trustAppUrl: 'https://trust.gideondefender.com/',
      organizationId: 'org_1',
    });

    expect(result).toBe('https://trust.gideondefender.com/acme');
  });

  it('ensures a friendlyUrl when none is stored', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      domain: null,
      domainVerified: false,
      friendlyUrl: null,
    });
    mockDb.trust.upsert.mockResolvedValue({ friendlyUrl: 'org_1' });
    // ensureFriendlyUrl re-reads the trust row after the initial read.
    mockDb.trust.findUnique
      .mockResolvedValueOnce({
        domain: null,
        domainVerified: false,
        friendlyUrl: null,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await buildPortalBaseUrl({
      trustAppUrl: 'https://trust.gideondefender.com',
      organizationId: 'org_1',
    });

    expect(result).toBe('https://trust.gideondefender.com/org_1');
  });
});

describe('buildPortalAccessUrl', () => {
  it('appends the access token to the base URL', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      domain: null,
      domainVerified: false,
      friendlyUrl: 'acme',
    });

    const result = await buildPortalAccessUrl({
      trustAppUrl: 'https://trust.gideondefender.com',
      organizationId: 'org_1',
      accessToken: 'tok_123',
    });

    expect(result).toBe('https://trust.gideondefender.com/acme/access/tok_123');
  });
});

describe('findPublishedTrustByRouteId', () => {
  it('resolves by friendlyUrl', async () => {
    const trust = { organizationId: 'org_1', status: 'published' };
    mockDb.trust.findUnique.mockResolvedValue(trust);

    const result = await findPublishedTrustByRouteId('acme');

    expect(result).toBe(trust);
    expect(mockDb.trust.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to organizationId', async () => {
    const trust = { organizationId: 'org_1', status: 'published' };
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.trust.findFirst.mockResolvedValue(trust);

    const result = await findPublishedTrustByRouteId('org_1');

    expect(result).toBe(trust);
  });

  it('throws not found for unpublished portals', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      organizationId: 'org_1',
      status: 'draft',
    });

    await expect(findPublishedTrustByRouteId('acme')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws not found when nothing matches', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.trust.findFirst.mockResolvedValue(null);

    await expect(findPublishedTrustByRouteId('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('buildPublicPortalBaseUrl', () => {
  const appUrl = 'https://trust.example.com';

  it('never writes when no trust row exists', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);

    const result = await buildPublicPortalBaseUrl({
      trustAppUrl: appUrl,
      organizationId: 'org_1',
    });

    expect(result).toBe('https://trust.example.com/org_1');
    expect(mockDb.trust.upsert).not.toHaveBeenCalled();
  });

  it('uses the stored friendlyUrl without ensuring', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      domain: null,
      domainVerified: false,
      friendlyUrl: 'acme',
    });

    const result = await buildPublicPortalBaseUrl({
      trustAppUrl: appUrl,
      organizationId: 'org_1',
    });

    expect(result).toBe('https://trust.example.com/acme');
    expect(mockDb.trust.upsert).not.toHaveBeenCalled();
  });

  it('prefers a verified custom domain', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      domain: 'Trust.Acme.com/',
      domainVerified: true,
      friendlyUrl: 'acme',
    });

    const result = await buildPublicPortalBaseUrl({
      trustAppUrl: appUrl,
      organizationId: 'org_1',
    });

    expect(result).toBe('https://trust.acme.com');
  });

  it('builds access and NDA links without writing', async () => {
    mockDb.trust.findUnique.mockResolvedValue({
      domain: null,
      domainVerified: false,
      friendlyUrl: 'acme',
    });

    const access = await buildPublicPortalAccessUrl({
      trustAppUrl: appUrl,
      organizationId: 'org_1',
      accessToken: 'tok_123',
    });
    const nda = await buildPublicNdaSigningLink({
      trustAppUrl: appUrl,
      organizationId: 'org_1',
      signToken: 'sign_123',
    });

    expect(access).toBe('https://trust.example.com/acme/access/tok_123');
    expect(nda).toBe('https://trust.example.com/acme/nda/sign_123');
    expect(mockDb.trust.upsert).not.toHaveBeenCalled();
  });
});

describe('isReservedPortalSlug', () => {
  it('reserves router literals case-insensitively', () => {
    expect(isReservedPortalSlug('nda')).toBe(true);
    expect(isReservedPortalSlug('Access')).toBe(true);
    expect(isReservedPortalSlug(' admin ')).toBe(true);
  });

  it('allows ordinary slugs', () => {
    expect(isReservedPortalSlug('acme')).toBe(false);
    expect(isReservedPortalSlug('ndax')).toBe(false);
    expect(isReservedPortalSlug('')).toBe(false);
  });
});

describe('ensureFriendlyUrl reserved slugs', () => {
  it('skips a reserved auto-slug and retries with a suffix', async () => {
    mockDb.trust.findUnique.mockResolvedValue(null);
    mockDb.trust.upsert.mockResolvedValue({ friendlyUrl: 'nda-2' });

    const result = await ensureFriendlyUrl('org_1', {
      organizationName: 'NDA',
    });

    expect(result).toBe('nda-2');
    expect(mockDb.trust.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.trust.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ friendlyUrl: 'nda-2' }),
      }),
    );
  });
});

describe('resolveTrustAppUrl', () => {
  const prevTrustAppUrl = process.env.TRUST_APP_URL;
  const prevPortalUrl = process.env.PORTAL_URL;
  const prevNodeEnv = process.env.NODE_ENV;

  function restoreEnv() {
    if (prevTrustAppUrl === undefined) delete process.env.TRUST_APP_URL;
    else process.env.TRUST_APP_URL = prevTrustAppUrl;
    if (prevPortalUrl === undefined) delete process.env.PORTAL_URL;
    else process.env.PORTAL_URL = prevPortalUrl;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }

  afterEach(() => {
    restoreEnv();
  });

  it('prefers TRUST_APP_URL over PORTAL_URL', () => {
    process.env.TRUST_APP_URL = 'https://trust.example.com';
    process.env.PORTAL_URL = 'https://portal.example.com';

    expect(resolveTrustAppUrl()).toBe('https://trust.example.com');
  });

  it('falls back to localhost outside production', () => {
    delete process.env.TRUST_APP_URL;
    delete process.env.PORTAL_URL;
    process.env.NODE_ENV = 'test';

    expect(resolveTrustAppUrl()).toBe('http://localhost:3008');
  });

  it('fails closed in production instead of emailing localhost links', () => {
    delete process.env.TRUST_APP_URL;
    delete process.env.PORTAL_URL;
    process.env.NODE_ENV = 'production';

    expect(() => resolveTrustAppUrl()).toThrow('TRUST_APP_URL');
  });
});
