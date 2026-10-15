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

/**
 * Assert the expand-window fallback ran as a single nulls-first raw lookup
 * for the normalized email. The NULLS FIRST ordering is load-bearing: an
 * owned row sharing the address must never shadow the claimable row.
 */
function expectExpandLookup(mock: jest.Mock, normalizedEmail: string): void {
  expect(mock).toHaveBeenCalledTimes(1);
  const [strings, ...values] = mock.mock.calls[0] as [
    TemplateStringsArray,
    ...unknown[],
  ];
  const sql = strings.join('?');
  expect(sql).toContain('NULLS FIRST');
  expect(sql).toContain('LIMIT 1');
  expect(values).toEqual([normalizedEmail]);
}

describe('provisionOidcUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no canonical subject link yet.
    mockFindUnique.mockResolvedValue(null);
    // Default: no expand-window candidates.
    mockQueryRaw.mockResolvedValue([]);
  });

  it('resolves the canonical subject first and skips the email lookup on a hit', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'person@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: TENANT_A,
    });
    mockUpdate.mockResolvedValue({ id: 'usr_a' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-a',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { gideonSub: 'sub-a' },
    });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a subject owned by another tenant instead of cross-tenant login', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'person@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: TENANT_A,
    });

    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-a',
        email: 'person@example.com',
        tenantId: TENANT_B,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('claims an expand-window null-tenant subject row for the login tenant', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_window',
      email: 'person@example.com',
      banned: false,
      gideonSub: 'sub-window',
      tenantId: null,
    });
    mockUpdate.mockResolvedValue({ id: 'usr_window' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-window',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_window' },
      data: expect.objectContaining({ tenantId: TENANT_A }),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('claims an expand-window null-tenant row on the tenant-scoped email link path', async () => {
    mockFindUnique.mockResolvedValue(null);
    // The tenant-scoped lookup excludes null ownership, so it misses; the
    // global expand-window fallback finds the legacy row and claims it.
    mockFindFirst.mockResolvedValueOnce(null);
    mockQueryRaw.mockResolvedValueOnce([
      {
        id: 'usr_legacy',
        banned: false,
        gideonSub: null,
        tenantId: null,
      },
    ]);
    mockUpdate.mockResolvedValue({ id: 'usr_legacy' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_A,
        email: { equals: 'person@example.com', mode: 'insensitive' },
      },
    });
    expectExpandLookup(mockQueryRaw, 'person@example.com');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_legacy', AND: { gideonSub: null } },
      data: expect.objectContaining({
        gideonSub: 'sub-1',
        tenantId: TENANT_A,
      }),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('excludes owned rows from the expand-window lookup so they cannot shadow the claim', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValueOnce(null);
    // Nulls-first ordering puts the tenant-less row at the head of the
    // single-row page: an owned row sharing the address never reaches the
    // claimant, no matter how many rows share the address.
    mockQueryRaw.mockResolvedValueOnce([
      {
        id: 'usr_legacy',
        banned: false,
        gideonSub: null,
        tenantId: null,
      },
    ]);
    mockUpdate.mockResolvedValue({ id: 'usr_legacy' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });

    expectExpandLookup(mockQueryRaw, 'person@example.com');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_legacy', AND: { gideonSub: null } },
      data: expect.objectContaining({
        gideonSub: 'sub-1',
        tenantId: TENANT_A,
      }),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('ignores an expand-window fallback row owned by another tenant and creates', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValueOnce(null);
    // Owned rows never match the tenant-less lookup, so the fallback misses
    // and creation proceeds.
    mockQueryRaw.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValue({ id: 'usr_new' });

    const result = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-1',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });

    expect(result).toEqual({ id: 'usr_new' });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: TENANT_A }),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects an expand-window fallback row linked to a different subject', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValueOnce(null);
    mockQueryRaw.mockResolvedValueOnce([
      {
        id: 'usr_legacy',
        banned: false,
        gideonSub: 'sub-other',
        tenantId: null,
      },
    ]);

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

  it('keeps tenant-less logins working for subject-linked rows on the legacy fallback', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'person@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: TENANT_A,
    });
    mockUpdate.mockResolvedValue({ id: 'usr_a' });

    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-a',
        email: 'person@example.com',
      }),
    ).resolves.toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
