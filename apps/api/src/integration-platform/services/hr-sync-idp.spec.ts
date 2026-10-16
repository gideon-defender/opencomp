jest.mock('../../auth/legacy-shared-user', () => ({
  findLegacySharedUser: jest.fn().mockResolvedValue(undefined),
}));
import { createHrIdentityResolver, getHrSyncUser } from './hr-sync-idp';

const mockFindUser = jest.fn();
const mockFindManyUsers = jest.fn();
const mockFindUserBySubject = jest.fn();
const mockCreateUser = jest.fn();
const mockUpdateUser = jest.fn();
const mockQueryRaw = jest.fn();
jest.mock('@db', () => ({
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUserBySubject(...args),
      findFirst: (...args: unknown[]) => mockFindUser(...args),
      findMany: (...args: unknown[]) => mockFindManyUsers(...args),
      create: (...args: unknown[]) => mockCreateUser(...args),
      update: (...args: unknown[]) => mockUpdateUser(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

const organizationId = '00000000-0000-4000-8000-000000000001';
const identity = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'employee@example.com',
  display_name: 'Employee',
  status: 'pending_enrollment' as const,
};
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const mockFetch = jest.fn();

function respond({
  tenantId = organizationId,
  user = identity,
}: { tenantId?: string; user?: typeof identity | null } = {}) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ tenant_id: tenantId, identity: user }),
  });
}

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

describe('HR local subject check with IdP fallback', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.GIDEON_HR_IDENTITY_URL = 'https://auth.internal.example.com';
    process.env.GIDEON_INTERNAL_SERVICE_TOKEN = 'test-token';
    global.fetch = mockFetch;
    respond();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('finds an IdP user who has never logged in and dedupes concurrent normalized emails per run', async () => {
    const resolve = createHrIdentityResolver({ organizationId });
    // In-flight dedup only: the resolver evicts settled lookups so later
    // retries re-execute instead of replaying a stale promise.
    const [first, second] = await Promise.all([
      resolve({ email: ' Employee@Example.com ' }),
      resolve({ email: identity.email }),
    ]);
    expect(first).toEqual(identity);
    expect(second).toEqual(identity);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toContain(
      `/tenants/${organizationId}/hr-identity?email=employee%40example.com`,
    );
    expect(options).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-internal-service-token': 'test-token',
        }),
        redirect: 'error',
      }),
    );
  });

  it('returns absence only for a successful tenant-scoped negative response', async () => {
    respond({ user: null });
    expect(
      await createHrIdentityResolver({ organizationId })({
        email: identity.email,
      }),
    ).toBeNull();
  });

  it.each([401, 404, 500])(
    'reports HTTP %s as a lookup error rather than absence',
    async (status) => {
      mockFetch.mockResolvedValue({ ok: false, status });
      await expect(
        createHrIdentityResolver({ organizationId })({ email: identity.email }),
      ).rejects.toThrow('IdP identity lookup failed');
    },
  );

  it('rejects cross-tenant identities', async () => {
    respond({ tenantId: '00000000-0000-4000-8000-000000000099' });
    await expect(
      createHrIdentityResolver({ organizationId })({ email: identity.email }),
    ).rejects.toThrow('mismatched tenant or email');
  });

  it('rejects a different email and malformed responses', async () => {
    respond({ user: { ...identity, email: 'other@example.com' } });
    await expect(
      createHrIdentityResolver({ organizationId })({ email: identity.email }),
    ).rejects.toThrow('mismatched tenant or email');
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(
      createHrIdentityResolver({ organizationId })({ email: identity.email }),
    ).rejects.toThrow();
  });

  it('requires authenticated IdP access only when no local subject is available', async () => {
    delete process.env.GIDEON_INTERNAL_SERVICE_TOKEN;
    delete process.env.INTERNAL_SERVICE_TOKEN;
    await expect(
      createHrIdentityResolver({ organizationId })({ email: identity.email }),
    ).rejects.toThrow('internal service token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses a tenant-owned local subject without an IdP call or remote credentials', async () => {
    delete process.env.GIDEON_INTERNAL_SERVICE_TOKEN;
    delete process.env.INTERNAL_SERVICE_TOKEN;
    mockFindUser.mockResolvedValue({
      email: identity.email,
      name: 'Employee',
      oidcSub: identity.id,
      tenantId: organizationId,
    });
    const resolve = createHrIdentityResolver({ organizationId });
    // In-flight dedup only (see above): concurrent resolves share one lookup.
    const [first, second] = await Promise.all([
      resolve({ email: ' Employee@Example.com ' }),
      resolve({ email: identity.email }),
    ]);
    expect(first).toEqual({
      id: identity.id,
      email: identity.email,
      display_name: 'Employee',
    });
    expect(second).toEqual(first);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockFindUser).toHaveBeenCalledTimes(1);
    expect(mockFindUser).toHaveBeenCalledWith({
      where: {
        tenantId: organizationId,
        email: { equals: identity.email, mode: 'insensitive' },
        oidcSub: { not: null },
      },
    });
  });

  it('ignores another tenant’s same-email subject and calls the IdP', async () => {
    mockFindUser.mockResolvedValue(null);
    expect(
      await createHrIdentityResolver({ organizationId })({
        email: identity.email,
      }),
    ).toEqual(identity);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFindUser).toHaveBeenCalledWith({
      where: {
        tenantId: organizationId,
        email: { equals: identity.email, mode: 'insensitive' },
        oidcSub: { not: null },
      },
    });
  });

  it.each([null, ' '])(
    'calls the IdP when the local subject is unavailable (%p)',
    async (oidcSub) => {
      mockFindUser.mockResolvedValue({ oidcSub });
      expect(
        await createHrIdentityResolver({ organizationId })({
          email: identity.email,
        }),
      ).toEqual(identity);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );
});

describe('HR local projection of existing IdP users', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Default: no expand-window candidates.
    mockQueryRaw.mockResolvedValue([]);
  });

  it('creates the local projection for an existing, never-logged-in IdP user', async () => {
    mockFindUser.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({
      id: 'user_1',
      email: identity.email,
      oidcSub: identity.id,
    });
    await getHrSyncUser({ identity, organizationId });
    expect(mockCreateUser).toHaveBeenCalledWith({
      data: {
        email: identity.email,
        name: 'Employee',
        emailVerified: false,
        oidcSub: identity.id,
        tenantId: organizationId,
        oidcTenantId: organizationId,
      },
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('links an existing same-tenant local user even without a prior IdP login', async () => {
    mockFindUser.mockResolvedValue({
      id: 'user_1',
      oidcSub: null,
      tenantId: organizationId,
    });
    await getHrSyncUser({ identity, organizationId });
    expect(mockUpdateUser).toHaveBeenCalledWith({
      where: { id: 'user_1', AND: { oidcSub: null } },
      data: { oidcSub: identity.id, oidcTenantId: organizationId },
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects linking a row owned by another tenant', async () => {
    mockFindUserBySubject.mockResolvedValue({
      id: 'user_other',
      email: identity.email,
      oidcSub: identity.id,
      tenantId: 'other-tenant',
    });
    await expect(getHrSyncUser({ identity, organizationId })).rejects.toThrow(
      'different tenant',
    );
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('claims an expand-window null-tenant row for the sync tenant', async () => {
    // The tenant-scoped lookup excludes null ownership, so it misses; the
    // global expand-window fallback finds the legacy row and claims it.
    mockFindUser.mockResolvedValueOnce(null);
    mockQueryRaw.mockResolvedValueOnce([
      {
        id: 'user_1',
        oidcSub: null,
        tenantId: null,
      },
    ]);
    mockUpdateUser.mockResolvedValue({ id: 'user_1' });
    await getHrSyncUser({ identity, organizationId });
    expect(mockFindUser).toHaveBeenCalledWith({
      where: {
        tenantId: organizationId,
        email: { equals: identity.email, mode: 'insensitive' },
      },
    });
    expectExpandLookup(mockQueryRaw, identity.email);
    expect(mockUpdateUser).toHaveBeenCalledWith({
      where: { id: 'user_1', AND: { oidcSub: null } },
      data: {
        oidcSub: identity.id,
        oidcTenantId: organizationId,
        tenantId: organizationId,
      },
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('ignores an expand-window fallback row owned by another tenant and creates', async () => {
    mockFindUser.mockResolvedValueOnce(null);
    // Owned rows never match the tenant-less lookup, so the fallback misses
    // and creation proceeds.
    mockQueryRaw.mockResolvedValueOnce([]);
    mockCreateUser.mockResolvedValue({ id: 'user_new' });
    await getHrSyncUser({ identity, organizationId });
    expect(mockCreateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: organizationId }),
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('does not change a valid existing identity link', async () => {
    mockFindUser.mockResolvedValue({
      id: 'user_1',
      email: identity.email,
      oidcSub: identity.id,
      tenantId: organizationId,
    });
    await getHrSyncUser({ identity, organizationId });
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('claims expand-window ownership on the already-linked fast path', async () => {
    mockFindUserBySubject.mockResolvedValue({
      id: 'user_1',
      email: identity.email,
      oidcSub: identity.id,
      tenantId: null,
    });
    mockUpdateUser.mockResolvedValue({
      id: 'user_1',
      email: identity.email,
      oidcSub: identity.id,
      tenantId: organizationId,
    });
    await expect(getHrSyncUser({ identity, organizationId })).resolves.toEqual(
      expect.objectContaining({ id: 'user_1', tenantId: organizationId }),
    );
    expect(mockUpdateUser).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { tenantId: organizationId },
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('claims expand-window ownership when a collision keeps the existing email', async () => {
    mockFindUserBySubject.mockResolvedValue({
      id: 'user_1',
      email: 'old@example.com',
      oidcSub: identity.id,
      tenantId: null,
    });
    mockFindUser.mockResolvedValue({ id: 'user_other' });
    mockUpdateUser.mockResolvedValue({
      id: 'user_1',
      tenantId: organizationId,
    });
    await expect(getHrSyncUser({ identity, organizationId })).resolves.toEqual(
      expect.objectContaining({ id: 'user_1', tenantId: organizationId }),
    );
    expect(mockUpdateUser).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { tenantId: organizationId },
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it.each([
    { oidcSub: 'another-sub', tenantId: organizationId },
    { oidcSub: null, banned: true, tenantId: organizationId },
  ])('rejects conflicting or disabled users %p', async (fields) => {
    mockFindUser.mockResolvedValue({ id: 'user_1', ...fields });
    await expect(getHrSyncUser({ identity, organizationId })).rejects.toThrow();
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('recovers a concurrent local provision without replacing an identity link', async () => {
    // Initial tenant-scoped miss, initial fallback miss, create races, and
    // the recovery tenant-scoped re-read finds the winner already linked.
    mockFindUser.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'user_1',
      email: identity.email,
      oidcSub: identity.id,
      tenantId: organizationId,
    });
    mockQueryRaw.mockResolvedValue([]);
    mockCreateUser.mockRejectedValue(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );
    expect(await getHrSyncUser({ identity, organizationId })).toEqual({
      id: 'user_1',
      email: identity.email,
      oidcSub: identity.id,
      tenantId: organizationId,
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
  it('reports a retryable error when the race winner vanishes', async () => {
    mockFindUser.mockResolvedValue(null);
    mockFindUserBySubject.mockResolvedValue(null);
    mockCreateUser.mockRejectedValue(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );
    await expect(getHrSyncUser({ identity, organizationId })).rejects.toThrow(
      'retry the sync',
    );
  });

  it('claims an expand-window row on the P2002 race-recovery path', async () => {
    // Initial tenant-scoped miss, initial fallback miss, create hits the
    // legacy global key, recovery tenant-scoped re-read misses, and the
    // recovery fallback claims the legacy row.
    mockFindUser.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'user_legacy',
        oidcSub: null,
        tenantId: null,
      },
    ]);
    mockCreateUser.mockRejectedValue(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );
    mockUpdateUser.mockResolvedValue({ id: 'user_legacy' });
    await getHrSyncUser({ identity, organizationId });
    expect(mockUpdateUser).toHaveBeenCalledWith({
      where: { id: 'user_legacy', AND: { oidcSub: null } },
      data: {
        oidcSub: identity.id,
        oidcTenantId: organizationId,
        tenantId: organizationId,
      },
    });
  });

  it('converges on the subject holder when the link collides on the global subject key', async () => {
    // A login claims this identity after our subject read missed: the
    // conditional link raises P2002 from the global oidcSub key, not the
    // composite email key. The email re-read returns the same still-unlinked
    // row, so recovery must fall through to the subject holder instead of
    // retrying the same write forever.
    const unlinked = {
      id: 'user_1',
      email: identity.email,
      oidcSub: null,
      tenantId: organizationId,
      banned: false,
    };
    const holder = {
      id: 'user_2',
      email: 'old@example.com',
      oidcSub: identity.id,
      tenantId: organizationId,
      banned: false,
    };
    mockFindUserBySubject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(holder);
    mockFindUser
      .mockResolvedValueOnce(unlinked)
      .mockResolvedValueOnce(unlinked)
      .mockResolvedValueOnce(null);
    mockUpdateUser
      .mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
      )
      .mockResolvedValueOnce({ ...holder, email: identity.email });
    const result = await getHrSyncUser({ identity, organizationId });
    expect(result).toEqual({ ...holder, email: identity.email });
    // Exactly two writes: the failed link plus the adopt on the holder.
    // A third write means the recovery looped on the same row.
    expect(mockUpdateUser).toHaveBeenCalledTimes(2);
    expect(mockUpdateUser).toHaveBeenNthCalledWith(2, {
      where: { id: 'user_2', oidcSub: identity.id },
      data: { email: identity.email },
    });
  });

  it('excludes owned rows from the expand-window lookup so they cannot shadow the claim', async () => {
    mockFindUser.mockResolvedValueOnce(null);
    // Nulls-first ordering puts the tenant-less row at the head of the
    // single-row page: an owned row sharing the address never reaches the
    // claimant.
    mockQueryRaw.mockResolvedValueOnce([
      {
        id: 'user_legacy',
        oidcSub: null,
        tenantId: null,
      },
    ]);
    mockUpdateUser.mockResolvedValue({ id: 'user_legacy' });
    await getHrSyncUser({ identity, organizationId });
    expectExpandLookup(mockQueryRaw, identity.email);
    expect(mockUpdateUser).toHaveBeenCalledWith({
      where: { id: 'user_legacy', AND: { oidcSub: null } },
      data: expect.objectContaining({ tenantId: organizationId }),
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('fails loudly when the expand-window ownership claim collides', async () => {
    mockFindUserBySubject.mockResolvedValue({
      id: 'user_1',
      email: identity.email,
      oidcSub: identity.id,
      tenantId: null,
    });
    mockFindUser.mockResolvedValue({ id: 'user_other' });
    mockUpdateUser.mockRejectedValue(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );
    await expect(getHrSyncUser({ identity, organizationId })).rejects.toThrow(
      'conflicts with user',
    );
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('converges when a concurrent link wins the same identity (P2025)', async () => {
    mockFindUser.mockResolvedValue({
      id: 'user_1',
      oidcSub: null,
      tenantId: organizationId,
    });
    mockUpdateUser.mockRejectedValueOnce(
      Object.assign(new Error('Record not found'), { code: 'P2025' }),
    );
    mockFindUserBySubject.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'user_1',
      email: identity.email,
      oidcSub: identity.id,
      tenantId: organizationId,
    });
    await expect(getHrSyncUser({ identity, organizationId })).resolves.toEqual(
      expect.objectContaining({ id: 'user_1', oidcSub: identity.id }),
    );
    // No second write: the winner already reached the desired end state.
    expect(mockUpdateUser).toHaveBeenCalledTimes(1);
  });

  it('rejects a P2025 loss when the winner linked a different identity', async () => {
    mockFindUser.mockResolvedValue({
      id: 'user_1',
      oidcSub: null,
      tenantId: organizationId,
    });
    mockUpdateUser.mockRejectedValueOnce(
      Object.assign(new Error('Record not found'), { code: 'P2025' }),
    );
    mockFindUserBySubject.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'user_1',
      email: 'other@example.com',
      oidcSub: 'other-sub',
      tenantId: organizationId,
    });
    await expect(getHrSyncUser({ identity, organizationId })).rejects.toThrow(
      'conflicts with the existing user link',
    );
  });

  it('reports a retryable error when the P2025 winner vanishes', async () => {
    mockFindUser.mockResolvedValue({
      id: 'user_1',
      oidcSub: null,
      tenantId: organizationId,
    });
    mockUpdateUser.mockRejectedValueOnce(
      Object.assign(new Error('Record not found'), { code: 'P2025' }),
    );
    mockFindUserBySubject.mockResolvedValue(null);
    await expect(getHrSyncUser({ identity, organizationId })).rejects.toThrow(
      'retry the sync',
    );
  });

  it('retries the adopt write after a P2025 loss on a linked row', async () => {
    const linked = {
      id: 'user_1',
      email: 'old@example.com',
      oidcSub: identity.id,
      tenantId: organizationId,
    };
    mockFindUserBySubject.mockResolvedValue(linked);
    mockFindUser.mockResolvedValue(null);
    mockUpdateUser
      .mockRejectedValueOnce(
        Object.assign(new Error('Record not found'), { code: 'P2025' }),
      )
      .mockResolvedValue({ ...linked, email: identity.email });
    await expect(getHrSyncUser({ identity, organizationId })).resolves.toEqual(
      expect.objectContaining({ email: identity.email }),
    );
    expect(mockUpdateUser).toHaveBeenCalledTimes(2);
    expect(mockUpdateUser).toHaveBeenLastCalledWith({
      where: { id: 'user_1', oidcSub: identity.id },
      data: { email: identity.email },
    });
  });
  it.each([false, true])(
    'preserves the user ID across an IdP email change (concurrent create: %p)',
    async (concurrent) => {
      const existing = {
        id: 'user_1',
        email: 'old@example.com',
        oidcSub: identity.id,
        tenantId: organizationId,
        emailVerified: true,
        lastLogin: new Date('2026-10-01'),
      };
      if (concurrent) {
        mockFindUserBySubject
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(existing);
        mockFindUser.mockResolvedValue(null);
        mockCreateUser.mockRejectedValue(
          Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
        );
      } else {
        mockFindUserBySubject.mockResolvedValue(existing);
      }
      mockUpdateUser.mockResolvedValue({ ...existing, email: identity.email });
      expect(await getHrSyncUser({ identity, organizationId })).toEqual({
        ...existing,
        email: identity.email,
      });
      expect(mockUpdateUser).toHaveBeenCalledWith({
        where: { id: 'user_1', oidcSub: identity.id },
        data: { email: identity.email },
      });
      if (!concurrent) expect(mockCreateUser).not.toHaveBeenCalled();
    },
  );

  it('keeps the existing email when the IdP email collides within the tenant', async () => {
    const existing = {
      id: 'user_1',
      email: 'old@example.com',
      oidcSub: identity.id,
      tenantId: organizationId,
    };
    mockFindUserBySubject.mockResolvedValue(existing);
    mockFindUser.mockResolvedValue({ id: 'user_other' });
    await expect(getHrSyncUser({ identity, organizationId })).resolves.toEqual(
      existing,
    );
    expect(mockFindUser).toHaveBeenCalledWith({
      where: {
        tenantId: organizationId,
        email: { equals: identity.email, mode: 'insensitive' },
        id: { not: 'user_1' },
      },
      select: { id: true },
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('keeps the existing email when adoption races a concurrent write', async () => {
    const existing = {
      id: 'user_1',
      email: 'old@example.com',
      oidcSub: identity.id,
      tenantId: organizationId,
    };
    mockFindUserBySubject.mockResolvedValue(existing);
    mockFindUser.mockResolvedValue(null);
    mockUpdateUser.mockRejectedValue(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );
    await expect(getHrSyncUser({ identity, organizationId })).resolves.toEqual(
      existing,
    );
    expect(mockUpdateUser).toHaveBeenCalledWith({
      where: { id: 'user_1', oidcSub: identity.id },
      data: { email: identity.email },
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('does not rename a disabled user found by subject', async () => {
    mockFindUserBySubject.mockResolvedValue({
      id: 'user_1',
      email: 'old@example.com',
      oidcSub: identity.id,
      banned: true,
    });
    await expect(getHrSyncUser({ identity, organizationId })).rejects.toThrow(
      'disabled',
    );
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
