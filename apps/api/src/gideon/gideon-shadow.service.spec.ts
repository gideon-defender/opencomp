import { GideonShadowService } from './gideon-shadow.service';

const mockOrgFindUnique = jest.fn();
const mockMemberFindFirst = jest.fn();

jest.mock('@db', () => ({
  db: {
    organization: {
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
    member: { findFirst: (...args: unknown[]) => mockMemberFindFirst(...args) },
  },
}));

describe('GideonShadowService', () => {
  let service: GideonShadowService;
  const OLD_ENV = process.env;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
    delete process.env.GIDEON_SHADOW_ENABLED;
    delete process.env.GIDEON_IDENTITY_URL;
    delete process.env.AUTH__IDENTITY_URL;
    delete process.env.GIDEON_INTERNAL_SERVICE_TOKEN;
    delete process.env.INTERNAL_SERVICE_TOKEN;
    // Default: shadow enabled via identityUrl
    process.env.GIDEON_IDENTITY_URL = 'https://auth.example.com';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    service = new GideonShadowService();
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('early returns when GIDEON_SHADOW_ENABLED=false', async () => {
    process.env.GIDEON_SHADOW_ENABLED = 'false';
    await service.logTenantOperationsMismatch('org_1', 'tok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('early returns when no identityUrl', async () => {
    delete process.env.GIDEON_IDENTITY_URL;
    delete process.env.AUTH__IDENTITY_URL;
    const s = new GideonShadowService();
    await s.logTenantOperationsMismatch('org_1', 'tok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs mismatch when gideon has tenant but opencomp has no org', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tenant: { name: 'Acme' } }),
    });
    mockOrgFindUnique.mockResolvedValue(null);

    const warn = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    await service.logTenantOperationsMismatch('org_1', 'tok');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/v1/platform/tenants/org_1/operations',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mismatch'));
  });

  it('logs mismatch when names differ', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Gideon Acme' }),
    });
    mockOrgFindUnique.mockResolvedValue({
      id: 'org_1',
      name: 'OpenComp Acme',
      createdAt: new Date(),
    });
    mockMemberFindFirst.mockResolvedValue({ id: 'mem_1' });

    const warn = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    await service.logTenantOperationsMismatch('org_1', 'tok');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mismatch'));
  });

  it('logs match when names equal', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Acme' }),
    });
    mockOrgFindUnique.mockResolvedValue({
      id: 'org_1',
      name: 'Acme',
      createdAt: new Date(),
    });
    mockMemberFindFirst.mockResolvedValue({ id: 'mem_1' });

    const debug = jest
      .spyOn(service['logger'], 'debug')
      .mockImplementation(() => undefined);

    await service.logTenantOperationsMismatch('org_1', 'tok');

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('match'));
  });

  it('resolves the local org by tid-as-id (tenant is the org)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tenant: { name: 'Acme' } }),
    });
    mockOrgFindUnique.mockResolvedValue({
      id: 'tenant-abc',
      name: 'Acme',
      createdAt: new Date(),
    });
    mockMemberFindFirst.mockResolvedValue(null);

    await service.logTenantOperationsMismatch('tenant-abc', 'tok');

    expect(mockOrgFindUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-abc' },
      select: { id: true, name: true, createdAt: true },
    });
    expect(mockMemberFindFirst).toHaveBeenCalledWith({
      where: { organizationId: 'tenant-abc' },
      select: { id: true },
    });
  });

  it('falls back to internalToken when gideonToken empty', async () => {
    process.env.GIDEON_INTERNAL_SERVICE_TOKEN = 'internal_123';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    mockOrgFindUnique.mockResolvedValue({
      id: 'org_1',
      name: 'Acme',
      createdAt: new Date(),
    });
    mockMemberFindFirst.mockResolvedValue({ id: 'mem_1' });

    await service.logTenantOperationsMismatch('org_1', '');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer internal_123',
        }),
      }),
    );
  });

  it('does not throw on fetch non-ok or network error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await expect(
      service.logTenantOperationsMismatch('org_1', 'tok'),
    ).resolves.toBeUndefined();

    fetchMock.mockRejectedValue(new Error('network'));
    await expect(
      service.logTenantOperationsMismatch('org_1', 'tok'),
    ).resolves.toBeUndefined();
  });

  it('logMismatch respects enabled flag', () => {
    process.env.GIDEON_SHADOW_ENABLED = 'false';
    const s = new GideonShadowService();
    const warn = jest
      .spyOn(s['logger'], 'warn')
      .mockImplementation(() => undefined);
    s.logMismatch('ctx', { a: 1 });
    expect(warn).not.toHaveBeenCalled();
  });
});
