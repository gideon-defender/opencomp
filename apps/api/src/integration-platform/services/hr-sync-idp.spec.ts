import { createHrIdentityResolver, getHrSyncUser } from './hr-sync-idp';

const mockFindUser = jest.fn();
const mockFindUserBySubject = jest.fn();
const mockCreateUser = jest.fn();
const mockUpdateUser = jest.fn();
jest.mock('@db', () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUserBySubject(...args),
      findFirst: (...args: unknown[]) => mockFindUser(...args),
      create: (...args: unknown[]) => mockCreateUser(...args),
      update: (...args: unknown[]) => mockUpdateUser(...args),
    },
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

  it('finds an IdP user who has never logged in and caches normalized emails per run', async () => {
    const resolve = createHrIdentityResolver({ organizationId });
    expect(await resolve({ email: ' Employee@Example.com ' })).toEqual(
      identity,
    );
    expect(await resolve({ email: identity.email })).toEqual(identity);
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

  it('uses a tenant-linked local subject without an IdP call or remote credentials', async () => {
    delete process.env.GIDEON_INTERNAL_SERVICE_TOKEN;
    delete process.env.INTERNAL_SERVICE_TOKEN;
    mockFindUser.mockResolvedValue({
      email: identity.email,
      name: 'Employee',
      gideonSub: identity.id,
      gideonTenantId: organizationId,
    });
    const resolve = createHrIdentityResolver({ organizationId });
    expect(await resolve({ email: ' Employee@Example.com ' })).toEqual({
      id: identity.id,
      email: identity.email,
      display_name: 'Employee',
    });
    await resolve({ email: identity.email });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockFindUser).toHaveBeenCalledTimes(1);
    expect(mockFindUser).toHaveBeenCalledWith({
      where: {
        email: { equals: identity.email, mode: 'insensitive' },
        gideonSub: { not: null },
        OR: [
          { gideonTenantId: organizationId },
          { gideonTenantId: null, members: { some: { organizationId } } },
        ],
      },
    });
  });

  it.each([null, ' '])(
    'calls the IdP when the local subject is unavailable (%p)',
    async (gideonSub) => {
      mockFindUser.mockResolvedValue({ gideonSub });
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
  beforeEach(() => jest.resetAllMocks());

  it('creates the local projection for an existing, never-logged-in IdP user', async () => {
    mockFindUser.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({
      id: 'user_1',
      email: identity.email,
      gideonSub: identity.id,
    });
    await getHrSyncUser({ identity, organizationId });
    expect(mockCreateUser).toHaveBeenCalledWith({
      data: {
        email: identity.email,
        name: 'Employee',
        emailVerified: false,
        gideonSub: identity.id,
        gideonTenantId: organizationId,
      },
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('links an existing local user even without a prior IdP login', async () => {
    mockFindUser.mockResolvedValue({ id: 'user_1', gideonSub: null });
    await getHrSyncUser({ identity, organizationId });
    expect(mockUpdateUser).toHaveBeenCalledWith({
      where: { id: 'user_1', AND: { gideonSub: null } },
      data: { gideonSub: identity.id, gideonTenantId: organizationId },
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('does not change a valid existing identity link', async () => {
    mockFindUser.mockResolvedValue({
      id: 'user_1',
      email: identity.email,
      gideonSub: identity.id,
    });
    await getHrSyncUser({ identity, organizationId });
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it.each([{ gideonSub: 'another-sub' }, { gideonSub: null, banned: true }])(
    'rejects conflicting or disabled users %p',
    async (fields) => {
      mockFindUser.mockResolvedValue({ id: 'user_1', ...fields });
      await expect(
        getHrSyncUser({ identity, organizationId }),
      ).rejects.toThrow();
      expect(mockUpdateUser).not.toHaveBeenCalled();
      expect(mockCreateUser).not.toHaveBeenCalled();
    },
  );

  it('recovers a concurrent local provision without replacing an identity link', async () => {
    mockFindUser.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'user_1',
      email: identity.email,
      gideonSub: identity.id,
    });
    mockCreateUser.mockRejectedValue(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    );
    expect(await getHrSyncUser({ identity, organizationId })).toEqual({
      id: 'user_1',
      email: identity.email,
      gideonSub: identity.id,
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'preserves the user ID across an IdP email change (concurrent create: %p)',
    async (concurrent) => {
      const existing = {
        id: 'user_1',
        email: 'old@example.com',
        gideonSub: identity.id,
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
        where: { id: 'user_1', gideonSub: identity.id },
        data: { email: identity.email },
      });
      if (!concurrent) expect(mockCreateUser).not.toHaveBeenCalled();
    },
  );

  it('does not rename a disabled user found by subject', async () => {
    mockFindUserBySubject.mockResolvedValue({
      id: 'user_1',
      email: 'old@example.com',
      gideonSub: identity.id,
      banned: true,
    });
    await expect(getHrSyncUser({ identity, organizationId })).rejects.toThrow(
      'disabled',
    );
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
