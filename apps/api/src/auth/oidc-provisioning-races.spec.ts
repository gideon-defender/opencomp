jest.mock('./legacy-shared-user', () => ({
  findLegacySharedUser: jest.fn().mockResolvedValue(undefined),
}));
import { ForbiddenException } from '@nestjs/common';
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

  it('recovers a raced same-tenant create through the tenant-scoped link path', async () => {
    // Initial tenant-scoped miss, initial fallback miss, create races, and
    // the recovery tenant-scoped re-read links the winner.
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'usr_raced',
      banned: false,
      gideonSub: null,
      tenantId: TENANT_A,
    });
    mockQueryRaw.mockResolvedValue([]);
    mockCreate.mockRejectedValue({ code: 'P2002' });
    mockUpdate.mockResolvedValue({ id: 'usr_raced' });

    const result = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });

    expect(result).toEqual({ id: 'usr_raced' });
    // Subject-first miss happens once up front; the P2002 recovery resolves
    // through the tenant-scoped email re-read, never a second subject lookup.
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { gideonSub: 'sub-1' },
    });
  });

  it('claims an expand-window row on the P2002 race-recovery path', async () => {
    // Initial tenant-scoped miss, initial fallback miss, create hits the
    // legacy global key, recovery tenant-scoped re-read misses, and the
    // recovery fallback claims the legacy row instead of looping in conflict.
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'usr_legacy',
        banned: false,
        gideonSub: null,
        tenantId: null,
      },
    ]);
    mockCreate.mockRejectedValue({ code: 'P2002' });
    mockUpdate.mockResolvedValue({ id: 'usr_legacy' });

    const result = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });

    expect(result).toEqual({ id: 'usr_legacy' });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_legacy', AND: { gideonSub: null } },
      data: expect.objectContaining({
        gideonSub: 'sub-1',
        tenantId: TENANT_A,
      }),
    });
  });

  it('runs the authorization hook exactly once when a create races', async () => {
    // Initial tenant-scoped miss, initial fallback miss, create races, and
    // the recovery tenant-scoped re-read links the winner.
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'usr_raced',
      banned: false,
      gideonSub: null,
      tenantId: TENANT_A,
    });
    mockQueryRaw.mockResolvedValue([]);
    mockCreate.mockRejectedValue({ code: 'P2002' });
    mockUpdate.mockResolvedValue({ id: 'usr_raced' });
    const beforeWrite = jest.fn().mockResolvedValue(undefined);

    const result = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'person@example.com',
      tenantId: TENANT_A,
      beforeWrite,
    });

    expect(result).toEqual({ id: 'usr_raced' });
    expect(beforeWrite).toHaveBeenCalledTimes(1);
  });

  it('runs the authorization hook exactly once on the raced-sub recovery path', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue({ code: 'P2002' });
    mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'usr_raced_sub',
      email: 'old@example.com',
      banned: false,
      gideonSub: 'sub-1',
      tenantId: TENANT_A,
    });
    mockUpdate.mockResolvedValue({ id: 'usr_raced_sub' });
    const beforeWrite = jest.fn().mockResolvedValue(undefined);

    const result = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'new@example.com',
      tenantId: TENANT_A,
      beforeWrite,
    });

    expect(result).toEqual({ id: 'usr_raced_sub' });
    expect(beforeWrite).toHaveBeenCalledTimes(1);
  });

  it('rejects a raced sub conflict owned by another tenant', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue({ code: 'P2002' });
    // Email race re-read misses in this tenant, but the subject belongs to
    // another tenant's user — reject instead of adopting it. The initial
    // subject-first lookup misses (null), so recovery actually reaches the
    // raced-sub branch.
    mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'usr_other_tenant',
      banned: false,
      gideonSub: 'sub-1',
      tenantId: TENANT_B,
    });

    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-1',
        email: 'person@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
