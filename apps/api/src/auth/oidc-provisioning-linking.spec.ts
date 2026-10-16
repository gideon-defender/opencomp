jest.mock('./legacy-shared-user', () => ({
  findLegacySharedUser: jest.fn().mockResolvedValue(undefined),
}));
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
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

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

describe('provisionOidcUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no canonical subject link yet.
    mockFindUnique.mockResolvedValue(null);
    // Default: no expand-window candidates.
    mockQueryRaw.mockResolvedValue([]);
  });

  it('links a legacy same-tenant row by normalized email', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue({
      id: 'usr_legacy',
      banned: false,
      oidcSub: null,
      tenantId: TENANT_A,
    });
    mockUpdate.mockResolvedValue({ id: 'usr_legacy' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'Ada@Example.COM ',
      tenantId: TENANT_A,
    });

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_A,
        email: { equals: 'ada@example.com', mode: 'insensitive' },
      },
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_legacy', AND: { oidcSub: null } },
      data: expect.objectContaining({ oidcSub: 'sub-1' }),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('never overwrites a conflicting subject on a same-tenant email match', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue({
      id: 'usr_other',
      banned: false,
      oidcSub: 'sub-other',
      tenantId: TENANT_A,
    });

    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-new',
        email: 'person@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict when a concurrent login links the row first', async () => {
    // The tenant-scoped email read finds an unlinked row; a concurrent login
    // links it before this login writes. The guarded update matches zero rows
    // (P2025) instead of overwriting the winner's subject.
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue({
      id: 'usr_legacy',
      banned: false,
      oidcSub: null,
      tenantId: TENANT_A,
    });
    mockUpdate.mockRejectedValue({ code: 'P2025' });

    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-1',
        email: 'person@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_legacy', AND: { oidcSub: null } },
      data: expect.objectContaining({ oidcSub: 'sub-1' }),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('ignores another tenant’s same-email row and creates an independent account', async () => {
    // Subject-first miss, then tenant-scoped email miss in tenant B even
    // though tenant A owns the same address: proves the lookup is scoped.
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'usr_b' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-b',
      email: 'person@example.com',
      tenantId: TENANT_B,
    });

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_B,
        email: { equals: 'person@example.com', mode: 'insensitive' },
      },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'person@example.com',
        oidcSub: 'sub-b',
        tenantId: TENANT_B,
      }),
    });
  });

  it('proves the same email logs in independently in two tenants', async () => {
    // Tenant A login creates/links User A (subject A).
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValueOnce({ id: 'usr_a' });
    const userA = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-a',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });
    expect(userA).toEqual({ id: 'usr_a' });

    // Tenant B login with a distinct subject resolves nothing tenant-scoped
    // and creates User B — never links or overwrites User A.
    jest.clearAllMocks();
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValueOnce({ id: 'usr_b' });
    const userB = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-b',
      email: 'Person@Example.com',
      tenantId: TENANT_B,
    });
    expect(userB).toEqual({ id: 'usr_b' });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_B,
        email: { equals: 'person@example.com', mode: 'insensitive' },
      },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('stores a normalized email for new users', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'usr_new' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'Ada@Example.COM ',
      tenantId: TENANT_A,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'ada@example.com' }),
    });
  });

  it('refuses to create a tenant-less user when the login carries no tenant', async () => {
    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-1',
        email: 'new@example.com',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
