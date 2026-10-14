jest.mock('./legacy-shared-user', () => ({
  findLegacySharedUser: jest.fn().mockResolvedValue(undefined),
}));
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  provisionGideonUser,
  resolveActiveOrganizationId,
} from './gideon-oidc-provisioning';

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

describe('provisionGideonUser', () => {
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

    await provisionGideonUser({
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
      provisionGideonUser({
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

    await provisionGideonUser({
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

    await provisionGideonUser({
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

    await provisionGideonUser({
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

    const result = await provisionGideonUser({
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
      provisionGideonUser({
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
      provisionGideonUser({ sub: 'sub-a', email: 'person@example.com' }),
    ).resolves.toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('links a legacy same-tenant row by normalized email', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue({
      id: 'usr_legacy',
      banned: false,
      gideonSub: null,
      tenantId: TENANT_A,
    });
    mockUpdate.mockResolvedValue({ id: 'usr_legacy' });

    await provisionGideonUser({
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
      where: { id: 'usr_legacy', AND: { gideonSub: null } },
      data: expect.objectContaining({ gideonSub: 'sub-1' }),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('never overwrites a conflicting subject on a same-tenant email match', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue({
      id: 'usr_other',
      banned: false,
      gideonSub: 'sub-other',
      tenantId: TENANT_A,
    });

    await expect(
      provisionGideonUser({
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
      gideonSub: null,
      tenantId: TENANT_A,
    });
    mockUpdate.mockRejectedValue({ code: 'P2025' });

    await expect(
      provisionGideonUser({
        sub: 'sub-1',
        email: 'person@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_legacy', AND: { gideonSub: null } },
      data: expect.objectContaining({ gideonSub: 'sub-1' }),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('ignores another tenant’s same-email row and creates an independent account', async () => {
    // Subject-first miss, then tenant-scoped email miss in tenant B even
    // though tenant A owns the same address: proves the lookup is scoped.
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'usr_b' });

    await provisionGideonUser({
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
        gideonSub: 'sub-b',
        tenantId: TENANT_B,
      }),
    });
  });

  it('proves the same email logs in independently in two tenants', async () => {
    // Tenant A login creates/links User A (subject A).
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValueOnce({ id: 'usr_a' });
    const userA = await provisionGideonUser({
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
    const userB = await provisionGideonUser({
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

    await provisionGideonUser({
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
      provisionGideonUser({ sub: 'sub-1', email: 'new@example.com' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockCreate).not.toHaveBeenCalled();
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

    const result = await provisionGideonUser({
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

    const result = await provisionGideonUser({
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

    const result = await provisionGideonUser({
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

    const result = await provisionGideonUser({
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
      provisionGideonUser({
        sub: 'sub-1',
        email: 'person@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('adopts the IdP email change on a subject hit when the address is free', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'old@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: TENANT_A,
    });
    mockFindFirst.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({ id: 'usr_a' });

    await provisionGideonUser({
      sub: 'sub-a',
      email: 'new@example.com',
      tenantId: TENANT_A,
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_a' },
      data: expect.objectContaining({ email: 'new@example.com' }),
    });
  });

  it('keeps the existing email on a subject hit when the new address collides', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'old@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: TENANT_A,
    });
    mockFindFirst.mockResolvedValue({ id: 'usr_other', tenantId: TENANT_A });
    mockUpdate.mockResolvedValue({ id: 'usr_a' });

    const result = await provisionGideonUser({
      sub: 'sub-a',
      email: 'taken@example.com',
      tenantId: TENANT_A,
    });

    // Login proceeds; the collision is logged for HR sync to resolve.
    expect(result).toEqual({ id: 'usr_a' });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_a' },
      data: expect.not.objectContaining({ email: expect.anything() }),
    });
  });

  it('keeps the existing email when adoption races a concurrent write', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'old@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: TENANT_A,
    });
    mockFindFirst.mockResolvedValue(null);
    mockUpdate
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValue({ id: 'usr_a' });

    const result = await provisionGideonUser({
      sub: 'sub-a',
      email: 'new@example.com',
      tenantId: TENANT_A,
    });

    expect(result).toEqual({ id: 'usr_a' });
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { id: 'usr_a' },
      data: expect.not.objectContaining({ email: expect.anything() }),
    });
  });

  it('leaves ownership unresolved when the expand-window claim collides', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'person@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: null,
    });
    mockFindFirst.mockResolvedValue(null);
    mockUpdate
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValue({ id: 'usr_a' });

    const result = await provisionGideonUser({
      sub: 'sub-a',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });

    // Login proceeds; the duplicate stays for explicit resolution.
    expect(result).toEqual({ id: 'usr_a' });
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { id: 'usr_a' },
      data: expect.not.objectContaining({ tenantId: expect.anything() }),
    });
  });

  it('rejects a banned account found by sub', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_old',
      email: 'old@example.com',
      banned: true,
      gideonSub: 'sub-1',
      tenantId: TENANT_A,
    });

    await expect(
      provisionGideonUser({
        sub: 'sub-1',
        email: 'new@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('converts a link-path sub race into Forbidden instead of a 500', async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'usr_other' });
    mockFindFirst.mockResolvedValue({
      id: 'usr_1',
      banned: false,
      gideonSub: null,
      tenantId: TENANT_A,
    });
    mockUpdate.mockRejectedValue({ code: 'P2002' });

    await expect(
      provisionGideonUser({
        sub: 'sub-1',
        email: 'ada@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('reports a retryable conflict when the link-path claim collides within the tenant', async () => {
    // The subject is free, but claiming the null-tenant row collides with
    // the tenant's existing composite key — retryable, not a link conflict.
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue({
      id: 'usr_1',
      banned: false,
      gideonSub: null,
      tenantId: null,
    });
    mockUpdate.mockRejectedValue({ code: 'P2002' });

    await expect(
      provisionGideonUser({
        sub: 'sub-1',
        email: 'ada@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('reports a retryable conflict when the race winner vanishes', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue({ code: 'P2002' });

    await expect(
      provisionGideonUser({
        sub: 'sub-1',
        email: 'new@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('provisionGideonUser tenant ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUnique.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([]);
  });

  it('stamps the login tenant on newly created users and never leaves it null', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'usr_new' });

    await provisionGideonUser({
      sub: 'sub-1',
      email: 'new@example.com',
      tenantId: 'tenant-1',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        gideonTenantId: 'tenant-1',
      }),
    });
  });

  it('never updates immutable tenantId when linking an existing user', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'usr_1',
      banned: false,
      gideonSub: null,
      tenantId: 'tenant-1',
    });
    mockUpdate.mockResolvedValue({ id: 'usr_1' });

    await provisionGideonUser({
      sub: 'sub-1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_1', AND: { gideonSub: null } },
      data: expect.not.objectContaining({ tenantId: expect.anything() }),
    });
  });
});

describe('resolveActiveOrganizationId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the tenant org id when the user is a member (tenant is the org)', async () => {
    mockOrgFindUnique.mockResolvedValue({ id: 'tenant-1' });
    mockMemberFindFirst.mockResolvedValue({ id: 'mem_1' });
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1', tenantId: 'tenant-1' }),
    ).resolves.toBe('tenant-1');

    expect(mockOrgFindUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      select: { id: true },
    });
    expect(mockMemberFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'usr_1',
        organizationId: 'tenant-1',
        deactivated: false,
        idpAccessRevoked: false,
      },
      select: { id: true },
    });
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it('resolves null for unknown tenants (setup flow, no most-recent fallback)', async () => {
    mockOrgFindUnique.mockResolvedValue(null);
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1', tenantId: 'tenant-1' }),
    ).resolves.toBeNull();
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it('resolves null when the user is not a member of the tenant org', async () => {
    mockOrgFindUnique.mockResolvedValue({ id: 'tenant-1' });
    mockMemberFindFirst.mockResolvedValue(null);
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1', tenantId: 'tenant-1' }),
    ).resolves.toBeNull();
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it('uses most-recent when no tenant id is given (legacy path)', async () => {
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1' }),
    ).resolves.toBe('org_recent');
    expect(mockOrgFindUnique).not.toHaveBeenCalled();
  });
});
