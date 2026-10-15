jest.mock('./legacy-shared-user', () => ({
  findLegacySharedUser: jest.fn().mockResolvedValue(undefined),
}));

import { provisionOidcUser } from './oidc-provisioning';

const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockQueryRaw = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockOrgFindFirst = jest.fn();
const mockOrgFindUnique = jest.fn();

jest.mock('@db', () => ({
  // normalizeEmail is used by the implementation; keep the mock faithful.
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    user: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
    },
    organization: {
      findFirst: (...args: unknown[]) => mockOrgFindFirst(...args),
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
    session: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

describe('provisionOidcUser tenant ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUnique.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([]);
  });

  it('stamps the login tenant on newly created users and never leaves it null', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'usr_new' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'new@example.com',
      tenantId: 'tenant-1',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        oidcTenantId: 'tenant-1',
      }),
    });
  });

  it('never updates immutable tenantId when linking an existing user', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'usr_1',
      banned: false,
      oidcSub: null,
      tenantId: 'tenant-1',
    });
    mockUpdate.mockResolvedValue({ id: 'usr_1' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_1', AND: { oidcSub: null } },
      data: expect.not.objectContaining({ tenantId: expect.anything() }),
    });
  });
});
